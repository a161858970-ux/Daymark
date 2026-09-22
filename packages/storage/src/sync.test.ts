import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, expect, it } from "vitest";
import {
  CourseManager,
  SyncWorker,
  type RemoteChange,
  type SyncTransport,
} from "@course-manager/application";
import { CourseManagerDb, DexieLocalRepository } from "./index.js";

const ownerId = "11111111-1111-4111-8111-111111111111";
const openDbs: CourseManagerDb[] = [];

afterEach(async () => {
  for (const db of openDbs.splice(0)) {
    db.close();
    await db.delete();
  }
});

it("keeps capture and ordered outbox across restart, then binds owner, pushes and pulls atomically", async () => {
  const name = `sync-test-${crypto.randomUUID()}`;
  const db = new CourseManagerDb(name);
  openDbs.push(db);
  const repo = new DexieLocalRepository(db);
  const fixed = {
    now: () => "2026-09-22T08:00:00.000Z",
    id: () => crypto.randomUUID(),
  };
  const manager = new CourseManager(repo, fixed);
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
  const reopened = new CourseManagerDb(name);
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
  const db = new CourseManagerDb(`sync-invalid-${crypto.randomUUID()}`);
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
  const db = new CourseManagerDb(`sync-overlap-${crypto.randomUUID()}`);
  openDbs.push(db);
  const repo = new DexieLocalRepository(db);
  const manager = new CourseManager(repo);
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
  const db = new CourseManagerDb(`sync-rejected-${crypto.randomUUID()}`);
  openDbs.push(db);
  const repo = new DexieLocalRepository(db);
  await new CourseManager(repo).capture("找学姐要笔记");
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

it("acknowledges a resolved conflict while preserving a later local edit", async () => {
  const db = new CourseManagerDb(`sync-resolution-${crypto.randomUUID()}`);
  openDbs.push(db);
  const repo = new DexieLocalRepository(db);
  const manager = new CourseManager(repo);
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
  const current = new CourseManagerDb(name);
  openDbs.push(current);
  const pending = await new DexieLocalRepository(current).pendingMutations();
  expect(pending).toHaveLength(1);
  expect(pending[0]?.mutation_id).toBe(mutation.mutation_id);
  expect(
    (await current.outbox_mutations.get(mutation.mutation_id))?.local_sequence,
  ).toBe(1);
});
