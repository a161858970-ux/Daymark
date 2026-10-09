import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import type { CloudDatabase } from "./cloud.js";
import { CloudConflictManager } from "./conflicts.js";
import { CloudSync } from "./sync.js";

const owner = "11111111-1111-4111-8111-111111111111";
const otherOwner = "22222222-2222-4222-8222-222222222222";
const now = "2026-09-23T08:00:00.000Z";

async function setup() {
  const db = new PGlite();
  for (const name of [
    "001_initial.sql",
    "002_collection_sync.sql",
    "005_schedule_times_nullable.sql",
    "007_date_precision.sql",
  ]) {
    const path = fileURLToPath(
      new URL(`../../../../backend/migrations/${name}`, import.meta.url),
    );
    await db.exec(await readFile(path, "utf8"));
  }
  const port: CloudDatabase = {
    query: async (sql, params) => db.query(sql, params),
    transaction: (work) =>
      db.transaction((tx) =>
        work({ query: async (sql, params) => tx.query(sql, params) }),
      ),
  };
  return {
    db,
    sync: new CloudSync(port),
    conflicts: new CloudConflictManager(port),
  };
}

function createCourse(id: string) {
  return {
    mutation_id: randomUUID(),
    entity_type: "COURSE" as const,
    entity_id: id,
    operation: "CREATE" as const,
    base_version: null,
    changed_fields: {
      name: "统计学",
      semester_id: null,
      instructor: null,
      created_at: now,
      updated_at: now,
    },
  };
}

function schedule(id: string, courseId: string, weekday: number) {
  return {
    id,
    course_id: courseId,
    weekday,
    start_time: "14:00:00",
    end_time: "15:40:00",
    week_start: 1,
    week_end: 13,
    classroom: "101",
    stage_label: null,
    created_at: now,
    updated_at: now,
  };
}

function scheduleReplacement(
  courseId: string,
  base: number,
  previous: ReturnType<typeof schedule>[],
  collection: ReturnType<typeof schedule>[],
) {
  return {
    mutation_id: randomUUID(),
    entity_type: "COURSE_SCHEDULE_COLLECTION" as const,
    entity_id: courseId,
    operation: "UPDATE" as const,
    base_version: base,
    changed_fields: {
      previous_collection: previous,
      collection,
    },
  };
}

it("replaces CourseSchedule as one replay-safe collection and resolves stale replacement", async () => {
  const { db, sync, conflicts } = await setup();
  const courseId = randomUUID();
  const first = schedule(randomUUID(), courseId, 3);
  const second = schedule(randomUUID(), courseId, 4);
  try {
    await sync.pushOne(owner, createCourse(courseId));
    const initial = scheduleReplacement(courseId, 0, [], [first]);
    expect(await sync.pushOne(owner, initial)).toEqual({
      mutation_id: initial.mutation_id,
      result: "ACK",
      entity_version: 1,
    });
    expect(await sync.pushOne(owner, initial)).toEqual({
      mutation_id: initial.mutation_id,
      result: "ACK",
      entity_version: 1,
    });
    const live = await db.query<{ id: string }>(
      "SELECT id FROM course_schedules WHERE course_id=$1 AND deleted_at IS NULL",
      [courseId],
    );
    expect(live.rows.map((row) => row.id)).toEqual([first.id]);
    const envelopes = await db.query<{
      entity_type: string;
      entity_id: string;
      changed_fields: { collection: { id: string }[] };
    }>(
      "SELECT entity_type,entity_id,changed_fields FROM change_log WHERE entity_type='COURSE_SCHEDULE_COLLECTION'",
    );
    expect(envelopes.rows).toHaveLength(1);
    expect(envelopes.rows[0]).toMatchObject({
      entity_id: courseId,
      changed_fields: { collection: [{ id: first.id }] },
    });

    const stale = scheduleReplacement(courseId, 0, [], [second]);
    const conflict = await sync.pushOne(owner, stale);
    expect(conflict.result).toBe("CONFLICT");
    if (conflict.result !== "CONFLICT") throw new Error("Expected conflict");
    expect(await sync.pushOne(owner, stale)).toEqual(conflict);
    const detail = await conflicts.get(owner, conflict.conflict_id);
    expect(detail.current_entity).toMatchObject({
      row_version: 1,
      collection: [{ id: first.id }],
    });
    const resolutionId = randomUUID();
    const resolved = await conflicts.resolve(
      owner,
      conflict.conflict_id,
      resolutionId,
      1,
      {
        strategy: "USE_LOCAL",
        field_resolutions: { collection: "LOCAL" },
      },
    );
    expect(resolved.entity).toMatchObject({
      row_version: 2,
      collection: [{ id: second.id }],
    });
    expect(
      await conflicts.resolve(owner, conflict.conflict_id, resolutionId, 1, {
        strategy: "USE_LOCAL",
        field_resolutions: { collection: "LOCAL" },
      }),
    ).toEqual(resolved);
    const rows = await db.query<{ id: string; deleted_at: string | null }>(
      "SELECT id,deleted_at FROM course_schedules WHERE course_id=$1 ORDER BY id",
      [courseId],
    );
    expect(
      rows.rows.find((row) => row.id === first.id)?.deleted_at,
    ).toBeTruthy();
    expect(
      rows.rows.find((row) => row.id === second.id)?.deleted_at,
    ).toBeNull();
    await expect(sync.pushOne(otherOwner, initial)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  } finally {
    await db.close();
  }
});

it("replaces SemesterWeek atomically with canonical client IDs and forms collection conflicts", async () => {
  const { db, sync, conflicts } = await setup();
  const semesterId = randomUUID();
  const firstId = randomUUID();
  const secondId = randomUUID();
  const semester = {
    mutation_id: randomUUID(),
    entity_type: "SEMESTER" as const,
    entity_id: semesterId,
    operation: "CREATE" as const,
    base_version: null,
    changed_fields: {
      name: "2026 秋季学期",
      start_date: "2026-09-01",
      end_date: "2026-12-31",
      created_at: now,
      updated_at: now,
    },
  };
  const week = (
    id: string,
    weekNumber: number,
    start: string,
    end: string,
  ) => ({
    id,
    semester_id: semesterId,
    week_number: weekNumber,
    start_date: start,
    end_date: end,
  });
  const first = week(firstId, 1, "2026-09-01", "2026-09-07");
  const second = week(secondId, 1, "2026-09-02", "2026-09-08");
  const replace = (base: number, previous: object[], collection: object[]) => ({
    mutation_id: randomUUID(),
    entity_type: "SEMESTER_WEEK_COLLECTION" as const,
    entity_id: semesterId,
    operation: "UPDATE" as const,
    base_version: base,
    changed_fields: { previous_collection: previous, collection },
  });
  try {
    await sync.pushOne(owner, semester);
    expect(await sync.pushOne(owner, replace(0, [], [first]))).toMatchObject({
      result: "ACK",
      entity_version: 1,
    });
    const stale = await sync.pushOne(owner, replace(0, [], [second]));
    expect(stale.result).toBe("CONFLICT");
    if (stale.result !== "CONFLICT") throw new Error("Expected conflict");
    const kept = await conflicts.resolve(
      owner,
      stale.conflict_id,
      randomUUID(),
      1,
      {
        strategy: "USE_REMOTE",
        field_resolutions: { collection: "REMOTE" },
      },
    );
    expect(kept.entity).toMatchObject({
      row_version: 1,
      collection: [{ id: firstId }],
    });
    const rows = await db.query<{ id: string }>(
      "SELECT id FROM semester_weeks WHERE semester_id=$1",
      [semesterId],
    );
    expect(rows.rows).toEqual([{ id: firstId }]);
    const otherSemesterId = randomUUID();
    await sync.pushOne(otherOwner, {
      ...semester,
      mutation_id: randomUUID(),
      entity_id: otherSemesterId,
    });
    await expect(
      sync.pushOne(otherOwner, {
        mutation_id: randomUUID(),
        entity_type: "SEMESTER_WEEK_COLLECTION",
        entity_id: otherSemesterId,
        operation: "UPDATE",
        base_version: 0,
        changed_fields: {
          previous_collection: [],
          collection: [
            {
              ...first,
              semester_id: otherSemesterId,
            },
          ],
        },
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const change = await sync.changes(owner, undefined, 20);
    expect(
      change.data.filter(
        (entry) => entry.entity_type === "SEMESTER_WEEK_COLLECTION",
      ),
    ).toHaveLength(1);
  } finally {
    await db.close();
  }
});

it("syncs ItemAssociation create and tombstone with canonical pair ordering", async () => {
  const { db, sync } = await setup();
  const firstId = randomUUID();
  const secondId = randomUUID();
  const associationId = randomUUID();
  const item = (id: string, title: string) => ({
    mutation_id: randomUUID(),
    entity_type: "ITEM" as const,
    entity_id: id,
    operation: "CREATE" as const,
    base_version: null,
    changed_fields: {
      title,
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
      due_date: null,
      time_zone: "UTC",
      reminder_level: "NORMAL",
      raw_capture_id: null,
      created_at: now,
      updated_at: now,
    },
  });
  const association = {
    mutation_id: randomUUID(),
    entity_type: "ITEM_ASSOCIATION" as const,
    entity_id: associationId,
    operation: "CREATE" as const,
    base_version: null,
    changed_fields: {
      item_id_a: secondId,
      item_id_b: firstId,
      created_at: now,
    },
  };
  try {
    await sync.pushOne(owner, item(firstId, "演讲"));
    await sync.pushOne(owner, item(secondId, "准备幻灯片"));
    expect(await sync.pushOne(owner, association)).toMatchObject({
      result: "ACK",
      entity_version: 1,
    });
    const row = await db.query<{
      id: string;
      item_id_a: string;
      item_id_b: string;
    }>("SELECT id,item_id_a,item_id_b FROM item_associations");
    expect(row.rows[0]).toMatchObject({ id: associationId });
    expect(row.rows[0]!.item_id_a < row.rows[0]!.item_id_b).toBe(true);
    const deletion = {
      mutation_id: randomUUID(),
      entity_type: "ITEM_ASSOCIATION" as const,
      entity_id: associationId,
      operation: "DELETE" as const,
      base_version: 1,
      changed_fields: { deleted_at: "2026-09-23T09:00:00.000Z" },
    };
    expect(await sync.pushOne(owner, deletion)).toMatchObject({
      result: "ACK",
      entity_version: 2,
    });
    const changes = await sync.changes(owner, undefined, 20);
    expect(
      changes.data
        .filter((entry) => entry.entity_type === "ITEM_ASSOCIATION")
        .map((entry) => entry.operation),
    ).toEqual(["CREATE", "DELETE"]);
    await expect(sync.pushOne(otherOwner, association)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  } finally {
    await db.close();
  }
});

it("merges non-overlapping Semester edits and records a same-field conflict", async () => {
  const { db, sync, conflicts } = await setup();
  const semesterId = randomUUID();
  const create = {
    mutation_id: randomUUID(),
    entity_type: "SEMESTER" as const,
    entity_id: semesterId,
    operation: "CREATE" as const,
    base_version: null,
    changed_fields: {
      name: "2026 秋季学期",
      start_date: "2026-09-01",
      end_date: "2026-12-31",
      created_at: now,
      updated_at: now,
    },
  };
  const update = (fields: Record<string, unknown>, base = 1) => ({
    mutation_id: randomUUID(),
    entity_type: "SEMESTER" as const,
    entity_id: semesterId,
    operation: "UPDATE" as const,
    base_version: base,
    changed_fields: fields,
  });
  try {
    await sync.pushOne(owner, create);
    expect(
      await sync.pushOne(owner, update({ name: "2026 秋季" })),
    ).toMatchObject({ result: "ACK", entity_version: 2 });
    expect(
      await sync.pushOne(owner, update({ end_date: "2026-12-30" })),
    ).toMatchObject({ result: "ACK", entity_version: 3 });
    const stale = await sync.pushOne(
      owner,
      update({ name: "秋季学期（本机）" }),
    );
    expect(stale.result).toBe("CONFLICT");
    if (stale.result !== "CONFLICT") throw new Error("Expected conflict");
    const detail = await conflicts.get(owner, stale.conflict_id);
    expect(detail.conflict.conflicting_fields).toEqual(["name"]);
    const resolved = await conflicts.resolve(
      owner,
      stale.conflict_id,
      randomUUID(),
      3,
      {
        strategy: "USE_LOCAL",
        field_resolutions: { name: "LOCAL" },
      },
    );
    expect(resolved.entity).toMatchObject({
      name: "秋季学期（本机）",
      end_date: "2026-12-30",
      row_version: 4,
    });
    expect(
      await sync.pushOne(owner, update({ start_date: "2026-09-02" }, 4)),
    ).toMatchObject({ result: "ACK", entity_version: 5 });
    await expect(
      sync.pushOne(owner, update({ name: "不可能的未来版本" }, 99)),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  } finally {
    await db.close();
  }
});
