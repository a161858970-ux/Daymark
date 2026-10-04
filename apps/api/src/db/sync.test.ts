import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import { buildServer } from "../server.js";
import { CloudCourseManager, type CloudDatabase } from "./cloud.js";
import { CloudSync } from "./sync.js";
import { CloudConflictManager } from "./conflicts.js";

const firstOwner = "11111111-1111-4111-8111-111111111111";
const secondOwner = "22222222-2222-4222-8222-222222222222";

it("replays local UUIDs, protects ownership, preserves provenance, and pulls ordered changes", async () => {
  const db = new PGlite();
  const migration = fileURLToPath(
    new URL("../../../../backend/migrations/001_initial.sql", import.meta.url),
  );
  await db.exec(await readFile(migration, "utf8"));
  const port: CloudDatabase = {
    query: async (sql, params) => db.query(sql, params),
    transaction: (work) =>
      db.transaction((tx) =>
        work({ query: async (sql, params) => tx.query(sql, params) }),
      ),
  };
  const server = buildServer({
    cloud: new CloudCourseManager(port),
    sync: new CloudSync(port),
    conflicts: new CloudConflictManager(port),
    verifyToken: async (token) =>
      token === "one" ? firstOwner : token === "two" ? secondOwner : null,
  });
  const deviceId = randomUUID();
  const rawId = randomUUID();
  const courseId = randomUUID();
  const itemId = randomUUID();
  const outputId = randomUUID();
  const create = (
    entity_type: string,
    entity_id: string,
    changed_fields: Record<string, unknown>,
  ) => ({
    mutation_id: randomUUID(),
    entity_type,
    entity_id,
    operation: "CREATE",
    base_version: null,
    changed_fields,
  });
  const raw = create("RAW_CAPTURE", rawId, {
    id: rawId,
    owner_id: secondOwner,
    source: "QUICK_CAPTURE",
    raw_text: "找学姐要笔记",
    captured_at: "2026-09-22T08:00:00Z",
    processing_status: "RAW",
    deleted_at: null,
  });
  const course = create("COURSE", courseId, {
    name: "环境经济学",
    semester_id: null,
    instructor: null,
    created_at: "2026-09-22T08:00:00Z",
    updated_at: "2026-09-22T08:00:00Z",
  });
  const item = create("ITEM", itemId, {
    title: "找学姐要笔记",
    detail: null,
    course_id: courseId,
    status: "INCOMPLETE",
    start_at: null,
    occurrence_start_at: null,
    occurrence_end_at: null,
    due_at: null,
    reminder_level: "NORMAL",
    raw_capture_id: rawId,
    created_at: "2026-09-22T08:00:00Z",
    updated_at: "2026-09-22T08:00:00Z",
  });
  const output = create("RAW_CAPTURE_OUTPUT", outputId, {
    raw_capture_id: rawId,
    object_type: "ITEM",
    object_id: itemId,
    created_at: "2026-09-22T08:00:01Z",
  });
  const rawResolved = {
    mutation_id: randomUUID(),
    entity_type: "RAW_CAPTURE",
    entity_id: rawId,
    operation: "UPDATE",
    base_version: 1,
    changed_fields: { processing_status: "RESOLVED" },
  };
  const push = (token: string, mutations: object[]) =>
    server.inject({
      method: "POST",
      url: "/api/v1/sync/push",
      headers: { authorization: `Bearer ${token}` },
      payload: { device_id: deviceId, mutations },
    });
  try {
    const unauthorized = await server.inject({
      method: "GET",
      url: "/api/v1/sync/changes",
    });
    expect(unauthorized.statusCode).toBe(401);
    const orphan = await push("one", [item]);
    expect(orphan.statusCode).toBe(404);
    const result = await push("one", [raw, course, item, output, rawResolved]);
    expect(result.statusCode).toBe(200);
    expect(
      result.json().data.map((entry: { result: string }) => entry.result),
    ).toEqual(["ACK", "ACK", "ACK", "ACK", "ACK"]);
    expect(
      (await push("one", [raw, course, item, output, rawResolved])).statusCode,
    ).toBe(200);
    expect(
      (await db.query<{ count: string }>("SELECT count(*) FROM items")).rows[0]
        ?.count,
    ).toBe(1);
    expect(
      (
        await db.query<{ id: string; owner_id: string }>(
          "SELECT id, owner_id FROM items",
        )
      ).rows[0],
    ).toMatchObject({ id: itemId, owner_id: firstOwner });
    expect(
      (
        await db.query<{ object_id: string }>(
          "SELECT object_id FROM raw_capture_outputs",
        )
      ).rows[0]?.object_id,
    ).toBe(itemId);
    const foreign = await push("two", [
      create("RAW_CAPTURE_OUTPUT", randomUUID(), {
        raw_capture_id: rawId,
        object_type: "ITEM",
        object_id: itemId,
        created_at: "2026-09-22T08:00:01Z",
      }),
    ]);
    expect(foreign.statusCode).toBe(404);
    const changes = await server.inject({
      method: "GET",
      url: "/api/v1/sync/changes?limit=2",
      headers: { authorization: "Bearer one" },
    });
    expect(changes.statusCode).toBe(200);
    expect(
      changes
        .json()
        .data.map((entry: { entity_id: string }) => entry.entity_id),
    ).toEqual([rawId, courseId]);
    expect(changes.json().meta.has_more).toBe(true);
    const next = await server.inject({
      method: "GET",
      url: `/api/v1/sync/changes?limit=2&cursor=${encodeURIComponent(changes.json().meta.next_cursor)}`,
      headers: { authorization: "Bearer one" },
    });
    expect(
      next.json().data.map((entry: { entity_id: string }) => entry.entity_id),
    ).toEqual([itemId, outputId]);
    const wrongOwnerCursor = await server.inject({
      method: "GET",
      url: `/api/v1/sync/changes?cursor=${encodeURIComponent(changes.json().meta.next_cursor)}`,
      headers: { authorization: "Bearer two" },
    });
    expect(wrongOwnerCursor.statusCode).toBe(400);
    expect(wrongOwnerCursor.json().error.code).toBe("SYNC_CURSOR_INVALID");
    const informationId = randomUUID();
    const information = create("COURSE_INFORMATION", informationId, {
      course_id: courseId,
      content: "教材是第三版",
      created_at: "2026-09-22T08:00:00Z",
      updated_at: "2026-09-22T08:00:00Z",
    });
    const revised = {
      mutation_id: randomUUID(),
      entity_type: "COURSE_INFORMATION",
      entity_id: informationId,
      operation: "UPDATE",
      base_version: 1,
      changed_fields: { content: "教材是第四版" },
    };
    const removed = {
      mutation_id: randomUUID(),
      entity_type: "COURSE_INFORMATION",
      entity_id: informationId,
      operation: "DELETE",
      base_version: 2,
      changed_fields: { deleted_at: "2026-09-22T09:00:00Z" },
    };
    expect((await push("one", [information])).json().data[0].result).toBe(
      "ACK",
    );
    const listedInformation = await server.inject({
      method: "GET",
      url: `/api/v1/courses/${courseId}/information`,
      headers: { authorization: "Bearer one" },
    });
    expect(
      listedInformation.json().data.map((entry: { id: string }) => entry.id),
    ).toEqual([informationId]);
    expect(
      (await push("one", [revised, removed]))
        .json()
        .data.map((entry: { result: string }) => entry.result),
    ).toEqual(["ACK", "ACK"]);
    const savedInformation = await db.query<{
      content: string;
      deleted_at: string;
    }>("SELECT content, deleted_at FROM course_information WHERE id = $1", [
      informationId,
    ]);
    expect(savedInformation.rows[0]?.content).toBe("教材是第四版");
    expect(savedInformation.rows[0]?.deleted_at).toBeTruthy();
    const hiddenInformation = await server.inject({
      method: "GET",
      url: `/api/v1/courses/${courseId}/information`,
      headers: { authorization: "Bearer one" },
    });
    expect(hiddenInformation.json().data).toEqual([]);

    const pendingId = randomUUID();
    const pendingRaw = create("RAW_CAPTURE", pendingId, {
      source: "QUICK_CAPTURE",
      raw_text: "第四周前交作业",
      captured_at: "2026-09-22T09:00:00Z",
    });
    const unresolved = {
      mutation_id: randomUUID(),
      entity_type: "RAW_CAPTURE",
      entity_id: pendingId,
      operation: "UPDATE",
      base_version: 1,
      changed_fields: {
        processing_status: "UNRESOLVED",
        unresolved_reason: "需要确认时间语义",
      },
    };
    expect((await push("one", [pendingRaw, unresolved])).statusCode).toBe(200);
    const pending = await server.inject({
      method: "GET",
      url: "/api/v1/raw-captures?processing_status=UNRESOLVED",
      headers: { authorization: "Bearer one" },
    });
    expect(
      pending.json().data.map((entry: { id: string }) => entry.id),
    ).toEqual([pendingId]);
    const otherPending = await server.inject({
      method: "GET",
      url: "/api/v1/raw-captures?processing_status=UNRESOLVED",
      headers: { authorization: "Bearer two" },
    });
    expect(otherPending.json().data).toEqual([]);
    const processing = {
      mutation_id: randomUUID(),
      entity_type: "RAW_CAPTURE",
      entity_id: pendingId,
      operation: "UPDATE",
      base_version: 2,
      changed_fields: { processing_status: "PROCESSING" },
    };
    const staleResolution = {
      ...processing,
      mutation_id: randomUUID(),
      changed_fields: { processing_status: "RESOLVED" },
    };
    expect((await push("one", [processing])).json().data[0].result).toBe("ACK");
    const rawConflict = (await push("one", [staleResolution])).json().data[0];
    expect(rawConflict.result).toBe("CONFLICT");
    const invalidCaptureStatus = await server.inject({
      method: "POST",
      url: `/api/v1/sync/conflicts/${rawConflict.conflict_id}/resolve`,
      headers: {
        authorization: "Bearer one",
        "idempotency-key": randomUUID(),
        "if-match": "3",
      },
      payload: {
        strategy: "USE_EXPLICIT_VALUE",
        field_resolutions: { processing_status: { value: "DELETED" } },
      },
    });
    expect(invalidCaptureStatus.statusCode).toBe(400);
    const resolvedRaw = await server.inject({
      method: "POST",
      url: `/api/v1/sync/conflicts/${rawConflict.conflict_id}/resolve`,
      headers: {
        authorization: "Bearer one",
        "idempotency-key": randomUUID(),
        "if-match": "3",
      },
      payload: {
        strategy: "USE_LOCAL",
        field_resolutions: { processing_status: "LOCAL" },
      },
    });
    expect(resolvedRaw.statusCode).toBe(200);
    expect(resolvedRaw.json().data.entity.processing_status).toBe("RESOLVED");

    const competingInfoId = randomUUID();
    expect(
      (
        await push("one", [
          create("COURSE_INFORMATION", competingInfoId, {
            course_id: courseId,
            content: "教材第一版",
            created_at: "2026-09-22T08:00:00Z",
            updated_at: "2026-09-22T08:00:00Z",
          }),
        ])
      ).json().data[0].result,
    ).toBe("ACK");
    const changeInfo = (content: string) => ({
      mutation_id: randomUUID(),
      entity_type: "COURSE_INFORMATION",
      entity_id: competingInfoId,
      operation: "UPDATE",
      base_version: 1,
      changed_fields: { content },
    });
    expect(
      (await push("one", [changeInfo("教材第二版")])).json().data[0].result,
    ).toBe("ACK");
    const infoConflict = (await push("one", [changeInfo("教材第三版")])).json()
      .data[0];
    expect(infoConflict.result).toBe("CONFLICT");
    const resolvedInfo = await server.inject({
      method: "POST",
      url: `/api/v1/sync/conflicts/${infoConflict.conflict_id}/resolve`,
      headers: {
        authorization: "Bearer one",
        "idempotency-key": randomUUID(),
        "if-match": "2",
      },
      payload: {
        strategy: "USE_EXPLICIT_VALUE",
        field_resolutions: { content: { value: "教材修订版" } },
      },
    });
    expect(resolvedInfo.statusCode).toBe(200);
    expect(resolvedInfo.json().data.entity.content).toBe("教材修订版");
    const changeAfterResolution = (content: string) => ({
      mutation_id: randomUUID(),
      entity_type: "COURSE_INFORMATION",
      entity_id: competingInfoId,
      operation: "UPDATE",
      base_version: 3,
      changed_fields: { content },
    });
    expect(
      (await push("one", [changeAfterResolution("新版备注")])).json().data[0]
        .result,
    ).toBe("ACK");
    const conflictBeforeDelete = (
      await push("one", [changeAfterResolution("本机旧备注")])
    ).json().data[0];
    expect(conflictBeforeDelete.result).toBe("CONFLICT");
    expect(
      (
        await push("one", [
          {
            mutation_id: randomUUID(),
            entity_type: "COURSE_INFORMATION",
            entity_id: competingInfoId,
            operation: "DELETE",
            base_version: 4,
            changed_fields: { deleted_at: "2026-09-22T09:30:00Z" },
          },
        ])
      ).json().data[0].result,
    ).toBe("ACK");
    const restoreByConflict = await server.inject({
      method: "POST",
      url: `/api/v1/sync/conflicts/${conflictBeforeDelete.conflict_id}/resolve`,
      headers: {
        authorization: "Bearer one",
        "idempotency-key": randomUUID(),
        "if-match": "5",
      },
      payload: {
        strategy: "USE_LOCAL",
        field_resolutions: { content: "LOCAL" },
      },
    });
    expect(restoreByConflict.statusCode).toBe(403);
    const keepRemoteDeletion = await server.inject({
      method: "POST",
      url: `/api/v1/sync/conflicts/${conflictBeforeDelete.conflict_id}/resolve`,
      headers: {
        authorization: "Bearer one",
        "idempotency-key": randomUUID(),
        "if-match": "5",
      },
      payload: {
        strategy: "USE_REMOTE",
        field_resolutions: { content: "REMOTE" },
      },
    });
    expect(keepRemoteDeletion.statusCode).toBe(200);
    expect(keepRemoteDeletion.json().data.entity.deleted_at).toBeTruthy();
  } finally {
    await server.close();
    await db.close();
  }
});

it("syncs CourseSchedule as a separate course fact with owner and version checks", async () => {
  const db = new PGlite();
  const migration = fileURLToPath(
    new URL("../../../../backend/migrations/001_initial.sql", import.meta.url),
  );
  await db.exec(await readFile(migration, "utf8"));
  const nullableMigration = fileURLToPath(
    new URL(
      "../../../../backend/migrations/005_schedule_times_nullable.sql",
      import.meta.url,
    ),
  );
  await db.exec(await readFile(nullableMigration, "utf8"));
  const port: CloudDatabase = {
    query: async (sql, params) => db.query(sql, params),
    transaction: (work) =>
      db.transaction((tx) =>
        work({ query: async (sql, params) => tx.query(sql, params) }),
      ),
  };
  const sync = new CloudSync(port);
  const courseId = randomUUID();
  const scheduleId = randomUUID();
  const now = "2026-09-22T08:00:00Z";
  const create = (
    entity_type: "COURSE" | "COURSE_SCHEDULE",
    entity_id: string,
    changed_fields: Record<string, unknown>,
  ) => ({
    mutation_id: randomUUID(),
    entity_type,
    entity_id,
    operation: "CREATE" as const,
    base_version: null,
    changed_fields,
  });
  try {
    await sync.pushOne(
      firstOwner,
      create("COURSE", courseId, {
        name: "统计学",
        semester_id: null,
        instructor: null,
        created_at: now,
        updated_at: now,
      }),
    );
    const schedule = create("COURSE_SCHEDULE", scheduleId, {
      course_id: courseId,
      weekday: 3,
      start_time: "14:00:00",
      end_time: "15:40:00",
      week_start: 1,
      week_end: 13,
      classroom: "101",
      stage_label: null,
      created_at: now,
      updated_at: now,
    });
    await expect(sync.pushOne(secondOwner, schedule)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(await sync.pushOne(firstOwner, schedule)).toMatchObject({
      result: "ACK",
      entity_version: 1,
    });
    expect(await sync.pushOne(firstOwner, schedule)).toMatchObject({
      result: "ACK",
      entity_version: 1,
    });
    // Periods-only member: both times null syncs as-is with the stage label.
    const undated = create("COURSE_SCHEDULE", randomUUID(), {
      course_id: courseId,
      weekday: 5,
      start_time: null,
      end_time: null,
      week_start: null,
      week_end: null,
      classroom: null,
      stage_label: "12-13节",
      created_at: now,
      updated_at: now,
    });
    expect(await sync.pushOne(firstOwner, undated)).toMatchObject({
      result: "ACK",
    });
    const undatedRows = await port.query<{
      start_time: string | null;
      stage_label: string | null;
    }>(
      "SELECT start_time, stage_label FROM course_schedules WHERE start_time IS NULL",
    );
    expect(undatedRows.rows).toHaveLength(1);
    expect(undatedRows.rows[0]).toMatchObject({ stage_label: "12-13节" });
    const deletion = {
      mutation_id: randomUUID(),
      entity_type: "COURSE_SCHEDULE" as const,
      entity_id: scheduleId,
      operation: "DELETE" as const,
      base_version: 1,
      changed_fields: { deleted_at: "2026-09-22T09:00:00Z" },
    };
    expect(await sync.pushOne(firstOwner, deletion)).toMatchObject({
      result: "ACK",
      entity_version: 2,
    });
    expect(await sync.pushOne(firstOwner, deletion)).toMatchObject({
      result: "ACK",
      entity_version: 2,
    });
    await expect(
      sync.pushOne(firstOwner, { ...deletion, mutation_id: randomUUID() }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    const row = await db.query<{ row_version: number; deleted_at: string }>(
      "SELECT row_version,deleted_at FROM course_schedules WHERE id=$1",
      [scheduleId],
    );
    expect(row.rows[0]?.row_version).toBe(2);
    expect(row.rows[0]?.deleted_at).toBeTruthy();
    const changes = await sync.changes(firstOwner, undefined, 10);
    expect(
      changes.data
        .filter((value) => value.entity_type === "COURSE_SCHEDULE")
        .map((value) => value.operation),
      // Two CREATEs: the timed member plus the periods-only member pushed
      // for the null-times case, then the timed member's DELETE.
    ).toEqual(["CREATE", "CREATE", "DELETE"]);
  } finally {
    await db.close();
  }
});

it("syncs Item complete, tombstone and bounded Undo through the same identity", async () => {
  const db = new PGlite();
  const migration = fileURLToPath(
    new URL("../../../../backend/migrations/001_initial.sql", import.meta.url),
  );
  await db.exec(await readFile(migration, "utf8"));
  const port: CloudDatabase = {
    query: async (sql, params) => db.query(sql, params),
    transaction: (work) =>
      db.transaction((tx) =>
        work({ query: async (sql, params) => tx.query(sql, params) }),
      ),
  };
  const server = buildServer({
    cloud: new CloudCourseManager(port),
    sync: new CloudSync(port),
    verifyToken: async () => firstOwner,
  });
  const itemId = randomUUID();
  const deviceId = randomUUID();
  const send = (mutations: object[]) =>
    server.inject({
      method: "POST",
      url: "/api/v1/sync/push",
      headers: { authorization: "Bearer one" },
      payload: { device_id: deviceId, mutations },
    });
  const mutate = (
    operation: string,
    base_version: number | null,
    changed_fields: Record<string, unknown>,
  ) => ({
    mutation_id: randomUUID(),
    entity_type: "ITEM",
    entity_id: itemId,
    operation,
    base_version,
    changed_fields,
  });
  try {
    const created = await send([
      mutate("CREATE", null, {
        title: "交论文",
        detail: null,
        course_id: null,
        status: "INCOMPLETE",
        start_at: null,
        occurrence_start_at: null,
        occurrence_end_at: null,
        due_at: null,
        reminder_level: "NORMAL",
        raw_capture_id: null,
        created_at: "2026-09-22T08:00:00Z",
        updated_at: "2026-09-22T08:00:00Z",
      }),
    ]);
    expect(created.json().data[0].entity_version).toBe(1);
    const complete = await send([
      mutate("UPDATE", 1, {
        status: "COMPLETE",
        completed_at: "2026-09-22T08:00:00Z",
      }),
    ]);
    expect(complete.json().data[0]).toMatchObject({
      result: "ACK",
      entity_version: 2,
    });
    const token = randomUUID();
    const deleted = await send([
      mutate("DELETE", 2, {
        deleted_at: "2026-09-22T08:00:01Z",
        undo_token: token,
      }),
    ]);
    expect(deleted.json().data[0]).toMatchObject({
      result: "ACK",
      entity_version: 3,
    });
    const undone = await send([
      mutate("UPDATE", 3, { deleted_at: null, undo_token: token }),
    ]);
    expect(undone.json().data[0]).toMatchObject({
      result: "ACK",
      entity_version: 4,
    });
    const item = await server.inject({
      method: "GET",
      url: `/api/v1/items/${itemId}`,
      headers: { authorization: "Bearer one" },
    });
    expect(item.json().data).toMatchObject({
      id: itemId,
      status: "COMPLETE",
      deleted_at: null,
    });
  } finally {
    await server.close();
    await db.close();
  }
});
