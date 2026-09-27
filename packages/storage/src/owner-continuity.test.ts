import "fake-indexeddb/auto";
import { afterEach, expect, it } from "vitest";
import {
  CourseManager,
  SyncWorker,
  type RemoteChange,
  type SyncTransport,
} from "@course-manager/application";
import {
  CourseManagerDb,
  DexieLocalRepository,
  OwnerBindingError,
} from "./index.js";

/**
 * Auth V1 owner continuity (acceptance items 20, 21, 24).
 *
 * The account model is "one auth.users.id, many identities". Signing in with
 * a different identity of the same account must therefore never rebind, split
 * or leak local data, while a genuinely different account must be rejected
 * before anything syncs.
 */

const ownerA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ownerB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const openDbs: CourseManagerDb[] = [];

afterEach(async () => {
  for (const db of openDbs.splice(0)) {
    db.close();
    await db.delete();
  }
});

async function seedLocalData(): Promise<{
  db: CourseManagerDb;
  repo: DexieLocalRepository;
}> {
  const name = `owner-continuity-${crypto.randomUUID()}`;
  const db = new CourseManagerDb(name);
  openDbs.push(db);
  const repo = new DexieLocalRepository(db);
  const fixed = {
    now: () => "2026-09-27T08:00:00.000Z",
    id: () => crypto.randomUUID(),
  };
  const manager = new CourseManager(repo, fixed);
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
