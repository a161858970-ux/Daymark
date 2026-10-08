import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, expect, it } from "vitest";
import {
  Daymark,
  SyncWorker,
  type RemoteChange,
  type SyncTransport,
} from "@daymark/application";
import { DaymarkDb, DexieLocalRepository } from "./index.js";

const ownerId = "11111111-1111-4111-8111-111111111111";
const openDbs: DaymarkDb[] = [];

afterEach(async () => {
  for (const db of openDbs.splice(0)) {
    db.close();
    await db.delete();
  }
});

it("keeps capture and ordered outbox across restart, then binds owner, pushes and pulls atomically", async () => {
  const name = `sync-test-${crypto.randomUUID()}`;
  const db = new DaymarkDb(name);
  openDbs.push(db);
  const repo = new DexieLocalRepository(db);
  const fixed = {
    now: () => "2026-09-22T08:00:00.000Z",
    id: () => crypto.randomUUID(),
  };
  const manager = new Daymark(repo, fixed);
  const course = await manager.createCourse("环境经济学");
  const raw = await manager.capture("找学姐要笔记", "COURSE_ITEM", course.id);
  const item = await manager.processClearCapture(raw.id);
  expect(item?.id).toBeTruthy();
  expect(
    (await repo.pendingMutations()).map((value) => value.entity_type),
  ).toEqual([
    "COURSE",
    "RAW_CAPTURE",
    "ITEM",
    "RAW_CAPTURE_OUTPUT",
    "RAW_CAPTURE",
  ]);
  db.close();
  const reopened = new DaymarkDb(name);
  openDbs.push(reopened);
  const resumed = new DexieLocalRepository(reopened);
  const sent: string[] = [];
  let online = false;
  let page: RemoteChange[] = [];
  const transport: SyncTransport = {
    identity: async () => ownerId,
    push: async (_deviceId, mutation) => {
      if (!online) throw new Error("offline");
      sent.push(`${mutation.entity_type}:${mutation.operation}`);
      expect(mutation.owner_id).toBe(ownerId);
      return {
        mutation_id: mutation.mutation_id,
        result: "ACK",
        entity_version: mutation.operation === "CREATE" ? 1 : 2,
      };
    },
    changes: async () => ({
      data: page,
      next_cursor: "cursor-1",
      has_more: false,
    }),
  };
  const worker = new SyncWorker(resumed, transport);
  expect((await worker.runOnce()).stopped).toBe("RETRY");
  expect((await resumed.getRawCapture(raw.id))?.raw_text).toBe("找学姐要笔记");
  expect(await resumed.pendingMutations()).toHaveLength(5);
  online = true;
  const result = await worker.runOnce();
  expect(result).toMatchObject({ pushed: 5, pulled: 0, stopped: null });
  expect(sent).toEqual([
    "COURSE:CREATE",
    "RAW_CAPTURE:CREATE",
    "ITEM:CREATE",
    "RAW_CAPTURE_OUTPUT:CREATE",
    "RAW_CAPTURE:UPDATE",
  ]);
  expect((await resumed.getItem(item!.id))?.id).toBe(item!.id);
  expect((await resumed.getItem(item!.id))?.owner_id).toBe(ownerId);
  expect(await resumed.pendingMutations()).toHaveLength(0);
  expect(await resumed.syncCursor()).toBe("cursor-1");

  page = [
    {
      id: "6",
      entity_type: "ITEM",
      entity_id: item!.id,
      operation: "UPDATE",
      changed_fields: { title: "找学姐要课程笔记" },
      entity_version: 2,
      server_time: "2026-09-22T08:00:01Z",
    },
  ];
  await worker.runOnce();
  expect((await resumed.getItem(item!.id))?.title).toBe("找学姐要课程笔记");
  expect(await resumed.serverVersion("ITEM", item!.id)).toBe(2);
});

it("does not advance pull cursor when a remote page cannot be applied", async () => {
  const db = new DaymarkDb(`sync-invalid-${crypto.randomUUID()}`);
  openDbs.push(db);
  const repo = new DexieLocalRepository(db);
  await expect(
    repo.applyRemoteChanges(
      ownerId,
      [
        {
          id: "1",
          entity_type: "ITEM",
          entity_id: crypto.randomUUID(),
          operation: "UPDATE",
          changed_fields: { title: "missing" },
          entity_version: 2,
          server_time: "2026-09-22T08:00:00Z",
        },
      ],
      "cursor-unsafe",
    ),
  ).rejects.toThrow(/no base entity/);
  expect(await repo.syncCursor()).toBeNull();
});

it("keeps the pull cursor when a new local edit overlaps a remote page", async () => {
  const db = new DaymarkDb(`sync-overlap-${crypto.randomUUID()}`);
  openDbs.push(db);
  const repo = new DexieLocalRepository(db);
  const manager = new Daymark(repo);
  const raw = await manager.capture("提交报告");
  const item = await manager.processClearCapture(raw.id);
  expect(item).toBeTruthy();
  await repo.bindOwner(ownerId);
  for (const mutation of await repo.pendingMutations())
    await repo.acknowledge(mutation.mutation_id, 1);
  await manager.updateItem(item!.id, { title: "本机标题" });
  const pending = (await repo.pendingMutations())[0]!;
  const remoteDetail: RemoteChange = {
    id: "10",
    entity_type: "ITEM",
    entity_id: item!.id,
    operation: "UPDATE",
    changed_fields: { detail: "另一设备补充" },
    entity_version: 2,
    server_time: "2026-09-22T08:00:01Z",
  };
  await expect(
    repo.applyRemoteChanges(ownerId, [remoteDetail], "cursor-10"),
  ).rejects.toThrow(/overlaps a new local mutation/);
  expect(await repo.syncCursor()).toBeNull();
  expect((await repo.getItem(item!.id))?.detail).toBeNull();
  await repo.acknowledge(pending.mutation_id, 3);
  await repo.applyRemoteChanges(
    ownerId,
    [
      remoteDetail,
      {
        ...remoteDetail,
        id: "11",
        changed_fields: { title: "本机标题" },
        entity_version: 3,
      },
    ],
    "cursor-11",
  );
  expect((await repo.getItem(item!.id))?.detail).toBe("另一设备补充");
  expect((await repo.getItem(item!.id))?.title).toBe("本机标题");
  expect(await repo.syncCursor()).toBe("cursor-11");
});

it("retains rejected mutations with diagnostics instead of acknowledging them", async () => {
  const db = new DaymarkDb(`sync-rejected-${crypto.randomUUID()}`);
  openDbs.push(db);
  const repo = new DexieLocalRepository(db);
  await new Daymark(repo).capture("找学姐要笔记");
  const worker = new SyncWorker(repo, {
    identity: async () => ownerId,
    push: async () => {
      throw Object.assign(new Error("Invalid input"), {
        code: "VALIDATION_ERROR",
      });
    },
    changes: async () => ({ data: [], next_cursor: "never", has_more: false }),
  });
  expect((await worker.runOnce()).stopped).toBe("ACTION_REQUIRED");
  const pending = await repo.pendingMutations();
  expect(pending).toHaveLength(1);
  expect(pending[0]?.last_error).toContain("VALIDATION_ERROR");
  expect(await repo.syncCursor()).toBeNull();
});

it("repairs an ACTION_REQUIRED edit with current local data and a new idempotency identity", async () => {
  const db = new DaymarkDb(`sync-repair-${crypto.randomUUID()}`);
  openDbs.push(db);
  const repo = new DexieLocalRepository(db);
  const manager = new Daymark(repo);
  const raw = await manager.capture("提交报告");
  const item = await manager.processClearCapture(raw.id);
  expect(item).toBeTruthy();
  await repo.bindOwner(ownerId);
  for (const mutation of await repo.pendingMutations())
    await repo.acknowledge(mutation.mutation_id, 1);
  await manager.updateItem(item!.id, { title: "待修复标题" });
  const rejected = (await repo.pendingMutations())[0]!;
  await repo.recordSyncFailure(
    rejected.mutation_id,
    "VALIDATION_ERROR: title needs repair",
  );
  await manager.updateItem(item!.id, { title: "已修复标题" });
  const issues = await repo.listActionRequiredIssues();
  expect(issues).toHaveLength(1);
  expect(issues[0]).toMatchObject({
    error_code: "VALIDATION_ERROR",
    can_retry: true,
    can_abandon: true,
    local_object: { id: item!.id, title: "已修复标题" },
  });
  const replacementId = await repo.retryActionRequired(rejected.mutation_id);
  expect(replacementId).not.toBe(rejected.mutation_id);
  const pending = await repo.pendingMutations();
  expect(pending[0]).toMatchObject({
    mutation_id: replacementId,
    entity_type: "ITEM",
    base_version: 1,
    changed_fields: { title: "已修复标题" },
    attempt_count: 0,
    last_error: null,
  });
  expect(pending.map((value) => value.mutation_id)).not.toContain(
    rejected.mutation_id,
  );
  expect(await repo.listSyncRepairDecisions()).toMatchObject([
    {
      mutation_id: rejected.mutation_id,
      action: "RETRY_CURRENT",
      replacement_mutation_id: replacementId,
      previous_error: "VALIDATION_ERROR: title needs repair",
    },
  ]);
});

it("abandons an expired Undo only by accepting synced state and preserving repair provenance", async () => {
  const db = new DaymarkDb(`sync-abandon-${crypto.randomUUID()}`);
  openDbs.push(db);
  const repo = new DexieLocalRepository(db);
  const manager = new Daymark(repo);
  const raw = await manager.capture("提交报告");
  const item = await manager.processClearCapture(raw.id);
  expect(item).toBeTruthy();
  await repo.bindOwner(ownerId);
  for (const mutation of await repo.pendingMutations())
    await repo.acknowledge(mutation.mutation_id, 1);
  const deletion = await manager.deleteItem(item!.id);
  const deleteMutation = (await repo.pendingMutations())[0]!;
  await repo.acknowledge(deleteMutation.mutation_id, 2);
  await manager.undoDelete(item!.id, deletion.token);
  const rejectedUndo = (await repo.pendingMutations())[0]!;
  await repo.recordSyncFailure(
    rejectedUndo.mutation_id,
    "FORBIDDEN: Undo window expired",
  );
  await db.settings.put({ key: "sync_pull_cursor", value: "cursor-before" });
  const issue = (await repo.listActionRequiredIssues())[0]!;
  expect(issue).toMatchObject({
    error_code: "FORBIDDEN",
    can_retry: false,
    can_abandon: true,
  });
  await repo.abandonActionRequired(rejectedUndo.mutation_id);
  expect(await repo.pendingMutations()).toHaveLength(0);
  expect(await repo.syncCursor()).toBeNull();
  expect(await repo.getDeleteUndo(item!.id)).toBeUndefined();
  expect((await repo.getItem(item!.id))?.deleted_at).toBeNull();
  await repo.applyRemoteChanges(
    ownerId,
    [
      {
        id: "30",
        entity_type: "ITEM",
        entity_id: item!.id,
        operation: "DELETE",
        changed_fields: { deleted_at: "2026-09-23T08:00:00.000Z" },
        entity_version: 2,
        server_time: "2026-09-23T08:00:00.000Z",
      },
    ],
    "cursor-30",
  );
  expect((await repo.getItem(item!.id))?.deleted_at).not.toBeNull();
  expect(await repo.listSyncRepairDecisions()).toMatchObject([
    {
      mutation_id: rejectedUndo.mutation_id,
      action: "ABANDON_TO_SYNCED",
      replacement_mutation_id: null,
      previous_error: "FORBIDDEN: Undo window expired",
    },
  ]);
});

it("acknowledges a resolved conflict while preserving a later local edit", async () => {
  const db = new DaymarkDb(`sync-resolution-${crypto.randomUUID()}`);
  openDbs.push(db);
  const repo = new DexieLocalRepository(db);
  const manager = new Daymark(repo);
  const raw = await manager.capture("提交报告");
  const item = await manager.processClearCapture(raw.id);
  expect(item).toBeTruthy();
  await repo.bindOwner(ownerId);
  for (const mutation of await repo.pendingMutations())
    await repo.acknowledge(mutation.mutation_id, 1);
  await manager.updateItem(item!.id, { title: "本机标题" });
  await manager.updateItem(item!.id, { detail: "后来补充的内容" });
  const mutations = await repo.pendingMutations();
  expect(mutations).toHaveLength(2);
  const conflictId = crypto.randomUUID();
  await repo.recordSyncFailure(
    mutations[0]!.mutation_id,
    `VERSION_CONFLICT:${conflictId}`,
  );
  const remote = {
    ...(await repo.getItem(item!.id))!,
    title: "其他设备标题",
    row_version: 4,
  };
  await repo.acceptResolvedConflict(
    {
      id: conflictId,
      owner_id: ownerId,
      entity_type: "ITEM",
      entity_id: item!.id,
      local_version: { title: "本机标题" },
      remote_version: { title: "其他设备标题" },
      conflicting_fields: ["title"],
      status: "RESOLVED",
      created_at: new Date().toISOString(),
      resolved_at: new Date().toISOString(),
    },
    remote,
  );
  expect(
    (await repo.pendingMutations()).map((value) => value.mutation_id),
  ).toEqual([mutations[1]!.mutation_id]);
  expect((await repo.getItem(item!.id))?.detail).toBe("后来补充的内容");
  expect(await repo.serverVersion("ITEM", item!.id)).toBe(4);
});

it("applies a collection envelope atomically and leaves its cursor unchanged on invalid data", async () => {
  const db = new DaymarkDb(`sync-collection-${crypto.randomUUID()}`);
  openDbs.push(db);
  const repo = new DexieLocalRepository(db);
  const manager = new Daymark(repo);
  const course = await manager.createCourse("统计学");
  await repo.bindOwner(ownerId);
  for (const mutation of await repo.pendingMutations())
    await repo.acknowledge(mutation.mutation_id, 1);
  const firstId = crypto.randomUUID();
  const secondId = crypto.randomUUID();
  const member = (id: string, weekday: number, courseId = course.id) => ({
    id,
    owner_id: ownerId,
    course_id: courseId,
    weekday,
    start_time: "14:00:00",
    end_time: "15:40:00",
    week_start: 1,
    week_end: 13,
    classroom: "101",
    stage_label: null,
    created_at: "2026-09-23T08:00:00.000Z",
    updated_at: "2026-09-23T08:00:00.000Z",
    deleted_at: null,
    row_version: 1,
  });
  await repo.applyRemoteChanges(
    ownerId,
    [
      {
        id: "20",
        entity_type: "COURSE_SCHEDULE_COLLECTION",
        entity_id: course.id,
        operation: "UPDATE",
        changed_fields: {
          parent_id: course.id,
          collection: [member(firstId, 3)],
        },
        entity_version: 1,
        server_time: "2026-09-23T08:00:00.000Z",
      },
    ],
    "cursor-20",
  );
  expect((await manager.courseSchedules(course.id))[0]?.id).toBe(firstId);
  await expect(
    repo.applyRemoteChanges(
      ownerId,
      [
        {
          id: "21",
          entity_type: "COURSE_SCHEDULE_COLLECTION",
          entity_id: course.id,
          operation: "UPDATE",
          changed_fields: {
            parent_id: course.id,
            collection: [member(secondId, 4, crypto.randomUUID())],
          },
          entity_version: 2,
          server_time: "2026-09-23T08:01:00.000Z",
        },
      ],
      "cursor-21",
    ),
  ).rejects.toThrow(/invalid/);
  expect(await repo.syncCursor()).toBe("cursor-20");
  expect((await manager.courseSchedules(course.id))[0]?.id).toBe(firstId);
  expect(
    await repo.serverVersion("COURSE_SCHEDULE_COLLECTION", course.id),
  ).toBe(1);
});

it("accepts a resolved collection conflict without overwriting a later local replacement", async () => {
  const db = new DaymarkDb(`sync-collection-resolution-${crypto.randomUUID()}`);
  openDbs.push(db);
  const repo = new DexieLocalRepository(db);
  const manager = new Daymark(repo);
  const course = await manager.createCourse("统计学");
  await repo.bindOwner(ownerId);
  for (const mutation of await repo.pendingMutations())
    await repo.acknowledge(mutation.mutation_id, 1);
  const fields = {
    weekday: 3,
    start_time: "14:00",
    end_time: "15:40",
    week_start: 1,
    week_end: 13,
    classroom: "101",
    stage_label: null,
  };
  const [first] = await manager.replaceCourseSchedules(course.id, [fields]);
  const conflictMutation = (await repo.pendingMutations())[0]!;
  const conflictId = crypto.randomUUID();
  await repo.recordSyncFailure(
    conflictMutation.mutation_id,
    `VERSION_CONFLICT:${conflictId}`,
  );
  const [later] = await manager.replaceCourseSchedules(course.id, [
    { ...fields, weekday: 5 },
  ]);
  await repo.acceptResolvedConflict(
    {
      id: conflictId,
      owner_id: ownerId,
      entity_type: "COURSE_SCHEDULE_COLLECTION",
      entity_id: course.id,
      local_version: { collection: [first] },
      remote_version: { collection: [] },
      conflicting_fields: ["collection"],
      status: "RESOLVED",
      created_at: "2026-09-23T08:00:00.000Z",
      resolved_at: "2026-09-23T08:01:00.000Z",
    },
    {
      id: course.id,
      owner_id: ownerId,
      row_version: 4,
      collection: [],
    },
  );
  expect(
    (await repo.pendingMutations()).map((value) => value.entity_id),
  ).toEqual([course.id]);
  expect((await manager.courseSchedules(course.id))[0]?.id).toBe(later!.id);
  expect(
    await repo.serverVersion("COURSE_SCHEDULE_COLLECTION", course.id),
  ).toBe(4);
});

it("upgrades a version 2 outbox without dropping unsent capture mutations", async () => {
  const name = `sync-upgrade-${crypto.randomUUID()}`;
  const legacy = new Dexie(name);
  legacy.version(2).stores({
    outbox_mutations: "mutation_id, owner_id, created_at, acked_at",
    settings: "key",
  });
  const mutation = {
    mutation_id: crypto.randomUUID(),
    owner_id: ownerId,
    entity_type: "RAW_CAPTURE",
    entity_id: crypto.randomUUID(),
    operation: "CREATE",
    base_version: null,
    changed_fields: { raw_text: "原文" },
    created_at: "2026-09-22T08:00:00Z",
    attempt_count: 0,
    last_error: null,
    acked_at: null,
  };
  await legacy.table("outbox_mutations").put(mutation);
  legacy.close();
  const current = new DaymarkDb(name);
  openDbs.push(current);
  const pending = await new DexieLocalRepository(current).pendingMutations();
  expect(pending).toHaveLength(1);
  expect(pending[0]?.mutation_id).toBe(mutation.mutation_id);
  expect(
    (await current.outbox_mutations.get(mutation.mutation_id))?.local_sequence,
  ).toBe(1);
});

it("applies a remote Semester deletion so switchers drop it", async () => {
  const name = `sync-semester-delete-${crypto.randomUUID()}`;
  const db = new DaymarkDb(name);
  openDbs.push(db);
  const repo = new DexieLocalRepository(db);
  const fixed = {
    now: () => "2026-10-05T08:00:00.000Z",
    id: () => crypto.randomUUID(),
  };
  const manager = new Daymark(repo, fixed);
  const ownerId = await repo.ownerId();
  const semester = await manager.createSemester(
    "被删学期",
    "2026-09-01",
    "2027-01-31",
  );
  // The create is still in the outbox; a remote page overlapping it is
  // (correctly) refused, so flush the queue the way a sync pass would.
  await db.outbox_mutations.clear();
  const change: RemoteChange = {
    id: crypto.randomUUID(),
    entity_type: "SEMESTER",
    entity_id: semester.id,
    operation: "DELETE",
    changed_fields: {
      deleted_at: "2026-10-05T09:00:00.000Z",
      updated_at: "2026-10-05T09:00:00.000Z",
    },
    entity_version: 2,
    server_time: "2026-10-05T09:00:01.000Z",
  };
  await repo.applyRemoteChanges(ownerId, [change], "cursor-semester-delete");
  const row = await db.semesters.get(semester.id);
  expect(row?.deleted_at).toBe("2026-10-05T09:00:00.000Z");
  expect(row?.row_version).toBe(2);
  expect(
    (await manager.listSemesters()).map((entry) => entry.id),
  ).not.toContain(semester.id);
  expect(await repo.syncCursor()).toBe("cursor-semester-delete");
});
