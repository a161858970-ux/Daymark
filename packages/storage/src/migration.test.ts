import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, expect, it } from "vitest";
import { SyncWorker, type SyncTransport } from "@daymark/application";
import { DaymarkDb, DexieLocalRepository } from "./index.js";

const databases: string[] = [];

const legacyStores = {
  semesters: "id, owner_id, [owner_id+start_date], deleted_at",
  semester_weeks: "id, semester_id, [semester_id+week_number]",
  courses: "id, owner_id, semester_id, [owner_id+name], deleted_at",
  course_schedules: "id, course_id, deleted_at",
  course_information: "id, owner_id, course_id, deleted_at",
  items:
    "id, owner_id, course_id, status, created_at, due_at, occurrence_start_at, start_at, deleted_at",
  item_associations: "id, owner_id, item_id_a, item_id_b, deleted_at",
  raw_captures: "id, owner_id, processing_status, captured_at, deleted_at",
  raw_capture_outputs:
    "id, owner_id, raw_capture_id, [raw_capture_id+object_type+object_id]",
  raw_capture_decisions: "id, raw_capture_id, decided_at",
  capture_contexts: "raw_capture_id, course_id",
  outbox_mutations:
    "mutation_id, owner_id, local_sequence, created_at, acked_at",
  sync_conflicts: "id, owner_id, status",
  sync_repair_decisions: "id, owner_id, mutation_id, decided_at",
  delete_undos: "item_id, expires_at",
  local_notification_schedule: "logical_key, item_id, state, scheduled_for",
  settings: "key",
};

function legacyDatabase(name: string): Dexie {
  const db = new Dexie(name);
  db.version(5).stores(legacyStores);
  return db;
}

afterEach(async () => {
  for (const name of databases.splice(0)) await Dexie.delete(name);
});

it("rehearses v5 row outbox upgrade into atomic collection commands without data loss", async () => {
  const name = `collection-migration-${crypto.randomUUID()}`;
  databases.push(name);
  const ownerId = "11111111-1111-4111-8111-111111111111";
  const semesterId = "22222222-2222-4222-8222-222222222222";
  const courseId = "33333333-3333-4333-8333-333333333333";
  const oldWeekId = "44444444-4444-4444-8444-444444444444";
  const newWeekId = "55555555-5555-4555-8555-555555555555";
  const oldScheduleId = "66666666-6666-4666-8666-666666666666";
  const newScheduleId = "77777777-7777-4777-8777-777777777777";
  const initial = "2026-09-01T08:00:00.000Z";
  const replaced = "2026-09-22T08:00:00.000Z";
  const legacy = legacyDatabase(name);
  await legacy.open();
  await legacy.table("semesters").put({
    id: semesterId,
    owner_id: ownerId,
    name: "2026 秋季",
    start_date: "2026-09-01",
    end_date: "2026-12-31",
    created_at: initial,
    updated_at: initial,
    deleted_at: null,
    row_version: 1,
  });
  await legacy.table("courses").put({
    id: courseId,
    owner_id: ownerId,
    semester_id: semesterId,
    name: "环境经济学",
    instructor: null,
    created_at: initial,
    updated_at: initial,
    deleted_at: null,
    row_version: 1,
  });
  const oldWeek = {
    id: oldWeekId,
    owner_id: ownerId,
    semester_id: semesterId,
    week_number: 1,
    start_date: "2026-09-01",
    end_date: "2026-09-06",
  };
  const newWeek = {
    id: newWeekId,
    owner_id: ownerId,
    semester_id: semesterId,
    week_number: 1,
    start_date: "2026-09-07",
    end_date: "2026-09-13",
  };
  await legacy.table("semester_weeks").put(newWeek);
  const oldSchedule = {
    id: oldScheduleId,
    owner_id: ownerId,
    course_id: courseId,
    weekday: 2,
    start_time: "08:00:00",
    end_time: "09:40:00",
    week_start: 1,
    week_end: 16,
    classroom: "A101",
    stage_label: null,
    created_at: initial,
    updated_at: replaced,
    deleted_at: replaced,
    row_version: 2,
  };
  const newSchedule = {
    id: newScheduleId,
    owner_id: ownerId,
    course_id: courseId,
    weekday: 4,
    start_time: "10:00:00",
    end_time: "11:40:00",
    week_start: 1,
    week_end: 16,
    classroom: "B202",
    stage_label: null,
    created_at: replaced,
    updated_at: replaced,
    deleted_at: null,
    row_version: 1,
  };
  await legacy.table("course_schedules").bulkPut([oldSchedule, newSchedule]);
  const mutation = (
    id: string,
    entityType: "SEMESTER_WEEK" | "COURSE_SCHEDULE",
    entityId: string,
    operation: "CREATE" | "DELETE",
    changedFields: Record<string, unknown>,
    sequence: number,
    ackedAt: string | null,
    createdAt = replaced,
  ) => ({
    mutation_id: id,
    owner_id: ownerId,
    entity_type: entityType,
    entity_id: entityId,
    operation,
    base_version: operation === "CREATE" ? null : 1,
    changed_fields: changedFields,
    created_at: createdAt,
    attempt_count: 0,
    last_error: null,
    acked_at: ackedAt,
    local_sequence: sequence,
  });
  await legacy
    .table("outbox_mutations")
    .bulkPut([
      mutation(
        "80000000-0000-4000-8000-000000000001",
        "SEMESTER_WEEK",
        oldWeekId,
        "CREATE",
        oldWeek,
        1,
        initial,
        initial,
      ),
      mutation(
        "80000000-0000-4000-8000-000000000002",
        "SEMESTER_WEEK",
        oldWeekId,
        "DELETE",
        { id: oldWeekId },
        2,
        null,
      ),
      mutation(
        "80000000-0000-4000-8000-000000000003",
        "SEMESTER_WEEK",
        newWeekId,
        "CREATE",
        newWeek,
        3,
        null,
      ),
      mutation(
        "80000000-0000-4000-8000-000000000004",
        "COURSE_SCHEDULE",
        oldScheduleId,
        "CREATE",
        oldSchedule,
        4,
        initial,
        initial,
      ),
      mutation(
        "80000000-0000-4000-8000-000000000005",
        "COURSE_SCHEDULE",
        oldScheduleId,
        "DELETE",
        { deleted_at: replaced },
        5,
        null,
      ),
      mutation(
        "80000000-0000-4000-8000-000000000006",
        "COURSE_SCHEDULE",
        newScheduleId,
        "CREATE",
        newSchedule,
        6,
        null,
      ),
    ]);
  await legacy.table("settings").bulkPut([
    { key: "local_owner_id", value: ownerId },
    { key: "outbox_next_sequence", value: "7" },
  ]);
  legacy.close();

  const upgraded = new DaymarkDb(name);
  await upgraded.open();
  const repo = new DexieLocalRepository(upgraded);
  expect(upgraded.verno).toBe(6);
  expect(await repo.listSemesterWeeks(semesterId)).toEqual([newWeek]);
  expect(await repo.listCourseSchedules(courseId)).toEqual([
    oldSchedule,
    newSchedule,
  ]);

  const pending = await repo.pendingMutations();
  expect(pending.map((value) => value.entity_type)).toEqual([
    "SEMESTER_WEEK_COLLECTION",
    "COURSE_SCHEDULE_COLLECTION",
  ]);
  expect(pending[0]).toMatchObject({
    entity_id: semesterId,
    operation: "UPDATE",
    base_version: 0,
    changed_fields: {
      previous_collection: [
        {
          id: oldWeekId,
          semester_id: semesterId,
          week_number: 1,
        },
      ],
      collection: [
        {
          id: newWeekId,
          semester_id: semesterId,
          week_number: 1,
        },
      ],
    },
  });
  expect(pending[1]).toMatchObject({
    entity_id: courseId,
    changed_fields: {
      previous_collection: [{ id: oldScheduleId, course_id: courseId }],
      collection: [{ id: newScheduleId, course_id: courseId }],
    },
  });
  const legacyPending = await upgraded.outbox_mutations
    .filter(
      (value) =>
        (value.entity_type === "SEMESTER_WEEK" ||
          value.entity_type === "COURSE_SCHEDULE") &&
        value.acked_at === null,
    )
    .count();
  expect(legacyPending).toBe(0);
  expect(
    (
      await upgraded.outbox_mutations.get(
        "80000000-0000-4000-8000-000000000002",
      )
    )?.last_error,
  ).toMatch(/^SUPERSEDED_BY_COLLECTION:/);

  const pushed: string[] = [];
  const transport: SyncTransport = {
    identity: async () => ownerId,
    push: async (_deviceId, outgoing) => {
      pushed.push(`${outgoing.entity_type}:${outgoing.entity_id}`);
      return {
        mutation_id: outgoing.mutation_id,
        result: "ACK",
        entity_version: 1,
      };
    },
    changes: async () => ({
      data: [],
      next_cursor: "migrated",
      has_more: false,
    }),
  };
  expect(await new SyncWorker(repo, transport).runOnce()).toEqual({
    pushed: 2,
    pulled: 0,
    stopped: null,
  });
  expect(pushed).toEqual([
    `SEMESTER_WEEK_COLLECTION:${semesterId}`,
    `COURSE_SCHEDULE_COLLECTION:${courseId}`,
  ]);
  expect(await repo.pendingMutations()).toHaveLength(0);
  upgraded.close();
});

it("quarantines an unresolvable legacy delete instead of partially syncing it", async () => {
  const name = `collection-migration-guard-${crypto.randomUUID()}`;
  databases.push(name);
  const ownerId = "11111111-1111-4111-8111-111111111111";
  const deletedWeekId = "99999999-9999-4999-8999-999999999999";
  const legacy = legacyDatabase(name);
  await legacy.open();
  await legacy.table("outbox_mutations").put({
    mutation_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    owner_id: ownerId,
    entity_type: "SEMESTER_WEEK",
    entity_id: deletedWeekId,
    operation: "DELETE",
    base_version: null,
    changed_fields: { id: deletedWeekId },
    created_at: "2026-09-22T08:00:00.000Z",
    attempt_count: 0,
    last_error: null,
    acked_at: null,
    local_sequence: 1,
  });
  await legacy.table("settings").bulkPut([
    { key: "local_owner_id", value: ownerId },
    { key: "outbox_next_sequence", value: "2" },
  ]);
  legacy.close();

  const upgraded = new DaymarkDb(name);
  await upgraded.open();
  const repo = new DexieLocalRepository(upgraded);
  const issue = (await repo.listActionRequiredIssues())[0];
  expect(issue).toMatchObject({
    error_code: "VALIDATION_ERROR",
    local_object: null,
    can_retry: false,
    can_abandon: true,
  });
  let pushes = 0;
  const worker = new SyncWorker(repo, {
    identity: async () => ownerId,
    push: async () => {
      pushes++;
      throw new Error("unreachable");
    },
    changes: async () => ({ data: [], next_cursor: "unused", has_more: false }),
  });
  expect(await worker.runOnce()).toEqual({
    pushed: 0,
    pulled: 0,
    stopped: "ACTION_REQUIRED",
  });
  expect(pushes).toBe(0);
  expect(await repo.pendingMutations()).toHaveLength(1);
  upgraded.close();
});
