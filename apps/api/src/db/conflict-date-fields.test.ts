import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import { CloudDaymark, type CloudDatabase } from "./cloud.js";
import { CloudSync } from "./sync.js";
import { CloudConflictManager } from "./conflicts.js";

it("resolves field conflicts that involve the DATE precision fields", async () => {
  const db = new PGlite();
  for (const name of [
    "001_initial.sql",
    "002_collection_sync.sql",
    "007_date_precision.sql",
  ]) {
    const migration = fileURLToPath(
      new URL(`../../../../backend/migrations/${name}`, import.meta.url),
    );
    await db.exec(await readFile(migration, "utf8"));
  }
  const port: CloudDatabase = {
    query: async (sql, params) => db.query(sql, params),
    transaction: (work) =>
      db.transaction((tx) =>
        work({ query: async (sql, params) => tx.query(sql, params) }),
      ),
  };
  const cloud = new CloudDaymark(port);
  const conflicts = new CloudConflictManager(port);
  try {
    const owner = randomUUID();
    const created = await cloud.createItem(owner, randomUUID(), {
      title: "交作业",
      detail: null,
      course_id: null,
      status: "INCOMPLETE",
      start_at: null,
      start_date: null,
      occurrence_start_at: null,
      occurrence_start_date: null,
      occurrence_end_at: null,
      occurrence_end_date: null,
      due_at: null,
      due_date: "2026-10-20",
      time_zone: "Asia/Shanghai",
      reminder_level: "NORMAL",
      raw_capture_id: null,
    });
    // A remote edit bumps the version first…
    await cloud.updateItem(owner, created.id, randomUUID(), 1, {
      due_date: "2026-10-22",
    });
    // …then a stale device pushes an edit whose change set carries the DATE
    // precision fields. This forms a field conflict that mentions due_date.
    let conflictId = "";
    try {
      await cloud.updateItem(owner, created.id, randomUUID(), 1, {
        title: "交作业（改）",
        due_date: "2026-10-21",
      });
      expect.unreachable("stale edit must conflict");
    } catch (error) {
      conflictId = String(
        (error as { details?: { conflict_id?: string } }).details
          ?.conflict_id ?? "",
      );
    }
    expect(conflictId).toBeTruthy();
    const detail = await conflicts.get(owner, conflictId);
    expect(detail.conflict.conflicting_fields).toContain("due_date");
    // Regression: the DATE fields used to be missing from the resolver's
    // allowedFields whitelist, so EVERY choice failed with
    // "Choose every conflicting field" and the UI showed 未能保存选择 forever.
    const resolved = await conflicts.resolve(
      owner,
      conflictId,
      randomUUID(),
      Number(detail.current_entity.row_version),
      {
        strategy: "USE_LOCAL",
        field_resolutions: Object.fromEntries(
          detail.conflict.conflicting_fields.map((field) => [field, "LOCAL"]),
        ),
      },
    );
    expect(resolved.conflict.status).toBe("RESOLVED");
    const item = await cloud.getItem(owner, created.id);
    expect(item?.title).toBe("交作业（改）");
    expect(item?.due_date).toBe("2026-10-21");
    expect(item?.time_zone).toBe("Asia/Shanghai");
  } finally {
    await db.close();
  }
});

it("resolves delete-vs-delete RawCapture conflicts instead of rejecting every choice", async () => {
  const db = new PGlite();
  for (const name of [
    "001_initial.sql",
    "002_collection_sync.sql",
    "007_date_precision.sql",
  ]) {
    const migration = fileURLToPath(
      new URL(`../../../../backend/migrations/${name}`, import.meta.url),
    );
    await db.exec(await readFile(migration, "utf8"));
  }
  const port: CloudDatabase = {
    query: async (sql, params) => db.query(sql, params),
    transaction: (work) =>
      db.transaction((tx) =>
        work({ query: async (sql, params) => tx.query(sql, params) }),
      ),
  };
  const cloud = new CloudDaymark(port);
  const sync = new CloudSync(port);
  const conflicts = new CloudConflictManager(port);
  try {
    const owner = randomUUID();
    const capture = await cloud.createRawCapture(owner, randomUUID(), {
      source: "QUICK_CAPTURE",
      raw_text: "零基础日语听说要记笔记",
      captured_at: "2026-10-09T06:47:00.000Z",
      captured_tz: null,
    });
    const captureId = capture.id;
    // Another device marks it UNRESOLVED first (row_version 2)…
    await sync.pushOne(owner, {
      mutation_id: randomUUID(),
      entity_type: "RAW_CAPTURE",
      entity_id: captureId,
      operation: "UPDATE",
      base_version: 1,
      changed_fields: {
        processing_status: "UNRESOLVED",
        unresolved_reason: "需要确认记录类型",
      },
    });
    // …then deletes it (row_version 3)…
    await sync.pushOne(owner, {
      mutation_id: randomUUID(),
      entity_type: "RAW_CAPTURE",
      entity_id: captureId,
      operation: "DELETE",
      base_version: 2,
      changed_fields: {
        processing_status: "DELETED",
        deleted_at: "2026-10-09T08:22:40.516Z",
      },
    });
    // …and a stale device deletes the same capture concurrently → conflict.
    const stale = await sync.pushOne(owner, {
      mutation_id: randomUUID(),
      entity_type: "RAW_CAPTURE",
      entity_id: captureId,
      operation: "DELETE",
      base_version: 2,
      changed_fields: {
        processing_status: "DELETED",
        deleted_at: "2026-10-09T06:51:05.775Z",
      },
    });
    expect(stale.result).toBe("CONFLICT");
    const conflictId = String(stale.conflict_id);
    const detail = await conflicts.get(owner, conflictId);
    expect(detail.conflict.conflicting_fields.sort()).toEqual([
      "deleted_at",
      "processing_status",
    ]);
    // Regression (field-conflict dead end found in acceptance): for an
    // already-deleted capture BOTH paths used to fail — any non-REMOTE choice
    // hit the no-resurrection rule (403) while the all-REMOTE choice tripped
    // "Only unresolved captures can be deleted" (400) because re-stating the
    // tombstone looked like a new deletion. Every choice showed 未能保存选择.
    const resolved = await conflicts.resolve(
      owner,
      conflictId,
      randomUUID(),
      Number(detail.current_entity.row_version),
      {
        strategy: "USE_REMOTE",
        field_resolutions: {
          deleted_at: "REMOTE",
          processing_status: "REMOTE",
        },
      },
    );
    expect(resolved.conflict.status).toBe("RESOLVED");
    // The product rule still holds: a deleted object cannot be resurrected.
    await expect(
      conflicts.resolve(
        owner,
        conflictId,
        randomUUID(),
        Number(detail.current_entity.row_version),
        {
          strategy: "USE_LOCAL",
          field_resolutions: {
            deleted_at: "LOCAL",
            processing_status: "LOCAL",
          },
        },
      ),
    ).rejects.toThrow();
  } finally {
    await db.close();
  }
});
