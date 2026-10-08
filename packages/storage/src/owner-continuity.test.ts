import "fake-indexeddb/auto";
import { afterEach, expect, it } from "vitest";
import {
  Daymark,
  SyncWorker,
  type RemoteChange,
  type SyncTransport,
} from "@daymark/application";
import { DaymarkDb, DexieLocalRepository, OwnerBindingError } from "./index.js";

/**
 * Auth V1 owner continuity (acceptance items 20, 21, 24).
 *
 * The account model is "one auth.users.id, many identities". Signing in with
 * a different identity of the same account must therefore never rebind, split
 * or leak local data, while a genuinely different account is rejected before
 * anything syncs — unless the store is still empty, where a rebind carries
 * nothing to migrate (fresh device that signed into the wrong account first).
 */

const ownerA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ownerB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const openDbs: DaymarkDb[] = [];

afterEach(async () => {
  for (const db of openDbs.splice(0)) {
    db.close();
    await db.delete();
  }
});

async function seedLocalData(): Promise<{
  db: DaymarkDb;
  repo: DexieLocalRepository;
}> {
  const name = `owner-continuity-${crypto.randomUUID()}`;
  const db = new DaymarkDb(name);
  openDbs.push(db);
  const repo = new DexieLocalRepository(db);
  const fixed = {
    now: () => "2026-09-27T08:00:00.000Z",
    id: () => crypto.randomUUID(),
  };
  const manager = new Daymark(repo, fixed);
  const course = await manager.createCourse("环境经济学");
  const raw = await manager.capture("找学姐要笔记", "COURSE_ITEM", course.id);
  await manager.processClearCapture(raw.id);
  return { db, repo };
}

it("keeps the same local binding when the sign-in identity switches", async () => {
  const { db, repo } = await seedLocalData();
  await repo.bindOwner(ownerA);
  // Phone OTP -> email OTP -> Google OAuth: same auth.users.id arrives again.
  await repo.bindOwner(ownerA);
  await repo.bindOwner(ownerA);

  expect((await db.settings.get("local_owner_id"))?.value).toBe(ownerA);
  expect((await db.settings.get("sync_bound_owner_id"))?.value).toBe(ownerA);

  for (const table of [db.courses, db.items, db.raw_captures]) {
    const rows = await table.toArray();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.owner_id === ownerA)).toBe(true);
  }
});

it("never migrates local data to a different account", async () => {
  const { db, repo } = await seedLocalData();
  await repo.bindOwner(ownerA);

  await expect(repo.bindOwner(ownerB)).rejects.toThrow(OwnerBindingError);

  expect((await db.settings.get("sync_bound_owner_id"))?.value).toBe(ownerA);
  const items = await db.items.toArray();
  expect(items.every((row) => row.owner_id === ownerA)).toBe(true);
  const courses = await db.courses.toArray();
  expect(courses.every((row) => row.owner_id === ownerA)).toBe(true);
});

it("rebinds a still-empty store that first signed into the wrong account", async () => {
  const name = `owner-continuity-${crypto.randomUUID()}`;
  const db = new DaymarkDb(name);
  openDbs.push(db);
  const repo = new DexieLocalRepository(db);

  // Fresh device: a throwaway phone-OTP account signs in first and leaves
  // an empty binding behind — there is nothing here to protect.
  await repo.bindOwner(ownerB);
  // The real account arrives; the store rebinds instead of deadlocking.
  await repo.bindOwner(ownerA);

  expect((await db.settings.get("sync_bound_owner_id"))?.value).toBe(ownerA);
  expect((await db.settings.get("local_owner_id"))?.value).toBe(ownerA);
});

it("lets accounts switch freely: each keeps its own store, no lock", async () => {
  if (typeof localStorage !== "undefined")
    localStorage.removeItem("daymark.active_owner");
  const name = `owner-scoped-${crypto.randomUUID()}`;
  const db = new DaymarkDb(name);
  openDbs.push(db);
  const repo = new DexieLocalRepository(db);
  const fixed = {
    now: () => "2026-10-06T08:00:00.000Z",
    id: () => crypto.randomUUID(),
  };
  const manager = new Daymark(repo, fixed);

  // Rows created before any sign-in belong to the first account arriving.
  await manager.createCourse("登录前课程");
  expect(await repo.activateOwner(ownerA)).toBe(true);
  await repo.bindOwner(ownerA);
  await manager.createCourse("A的课程");
  expect((await repo.listCourses()).map((c) => c.name)).toEqual(
    expect.arrayContaining(["登录前课程", "A的课程"]),
  );

  // Account B signs in on the same device: its store is fresh — none of
  // A's rows are visible, none migrate, nothing blocks the switch.
  expect(await repo.activateOwner(ownerB)).toBe(true);
  await repo.bindOwner(ownerB);
  expect(await repo.listCourses()).toHaveLength(0);
  expect(await repo.listItems()).toHaveLength(0);

  // Back to A: everything intact, no unlock, no repair step.
  expect(await repo.activateOwner(ownerA)).toBe(true);
  expect((await repo.listCourses()).map((c) => c.name)).toEqual(
    expect.arrayContaining(["登录前课程", "A的课程"]),
  );
  expect((await repo.listCourses()).every((c) => c.owner_id === ownerA)).toBe(
    true,
  );
  // Re-activating the current account is a no-op.
  expect(await repo.activateOwner(ownerA)).toBe(false);
  // B's store still has nothing of A's.
  await repo.activateOwner(ownerB);
  expect(await repo.listCourses()).toHaveLength(0);
});

it("discards a pull cursor issued to a different account", async () => {
  const db = new DaymarkDb(`cursor-guard-${crypto.randomUUID()}`);
  openDbs.push(db);
  const repo = new DexieLocalRepository(db);
  await repo.bindOwner(ownerA);
  const encode = (payload: object) =>
    btoa(JSON.stringify(payload))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/, "");

  // A cursor belonging to another account: the server would answer
  // SYNC_CURSOR_INVALID forever — the client must drop it instead.
  await db.settings.put({
    key: "sync_pull_cursor",
    value: encode({ v: 1, owner: ownerB, after: "0" }),
  });
  expect(await repo.syncCursor()).toBeNull();
  expect(await db.settings.get("sync_pull_cursor")).toBeUndefined();

  // Our own cursor stays.
  await db.settings.put({
    key: "sync_pull_cursor",
    value: encode({ v: 1, owner: ownerA, after: "7" }),
  });
  expect(await repo.syncCursor()).not.toBeNull();
});

it("never copies shared-store account keys into the first account's store", async () => {
  if (typeof localStorage !== "undefined")
    localStorage.removeItem("daymark.active_owner");
  const name = `migrate-skip-${crypto.randomUUID()}`;
  const db = new DaymarkDb(name);
  openDbs.push(db);
  const repo = new DexieLocalRepository(db);
  const encode = (payload: object) =>
    btoa(JSON.stringify(payload))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/, "");
  // Shared bootstrap leftovers from an earlier account's era.
  await db.settings.put({
    key: "sync_pull_cursor",
    value: encode({ v: 1, owner: ownerB, after: "0" }),
  });
  await db.settings.put({ key: "local_device_id", value: "device-from-phone" });
  await db.settings.put({ key: "local_owner_id", value: ownerB });

  await repo.activateOwner(ownerA);

  expect(await repo.syncCursor()).toBeNull();
  expect(await repo.db.settings.get("sync_pull_cursor")).toBeUndefined();
  expect(await repo.db.settings.get("local_device_id")).toBeUndefined();
  expect(await repo.db.settings.get("local_owner_id")).toBeUndefined();
  // The rows (none here) and non-account settings still travel.
  expect((await db.settings.get("bootstrap_claimed_by"))?.value).toBe(ownerA);
});

it("refuses to sync another owner's data and keeps the outbox intact", async () => {
  const { repo } = await seedLocalData();
  await repo.bindOwner(ownerA);
  const pendingBefore = (await repo.pendingMutations()).length;
  expect(pendingBefore).toBeGreaterThan(0);

  const remote: RemoteChange[] = [];
  const transport: SyncTransport = {
    identity: async () => ownerB,
    push: async () => ({
      mutation_id: "1",
      result: "ACK",
      entity_version: 1,
    }),
    changes: async () => ({
      data: remote,
      next_cursor: "cursor-1",
      has_more: false,
    }),
  };
  const worker = new SyncWorker(repo, transport);

  await expect(worker.runOnce()).rejects.toThrow(OwnerBindingError);
  // Nothing was pushed, pulled or dropped locally.
  expect((await repo.pendingMutations()).length).toBe(pendingBefore);
  const items = await repo.listItems();
  expect(items.every((row) => row.owner_id === ownerA)).toBe(true);
});
