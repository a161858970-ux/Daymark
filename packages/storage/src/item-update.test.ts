import "fake-indexeddb/auto";
import { afterEach, expect, it } from "vitest";
import { Daymark } from "@daymark/application";
import type { Item } from "@daymark/domain";
import { DaymarkDb, DexieLocalRepository } from "./index.js";

/**
 * Spec 14 §22.3 / 17: edits whose fields do not overlap must merge on the
 * server. That is only possible when the client reports the fields it really
 * changed — an edit form submits every rendered field, so the application
 * layer has to strip the untouched ones before they reach the outbox.
 */

const openDbs: DaymarkDb[] = [];

afterEach(async () => {
  for (const db of openDbs.splice(0)) {
    db.close();
    await db.delete();
  }
});

async function seedItem(): Promise<{
  manager: Daymark;
  repo: DexieLocalRepository;
  item: Item;
}> {
  const db = new DaymarkDb(`item-update-${crypto.randomUUID()}`);
  openDbs.push(db);
  const repo = new DexieLocalRepository(db);
  const manager = new Daymark(repo, {
    now: () => "2026-09-27T08:00:00.000Z",
    id: () => crypto.randomUUID(),
  });
  const course = await manager.createCourse("环境经济学");
  const raw = await manager.capture("买牛奶", "COURSE_ITEM", course.id);
  const item = await manager.processClearCapture(raw.id);
  if (!item) throw new Error("expected a parsed item");
  return { manager, repo, item };
}

function fullSnapshot(item: Item) {
  return {
    title: "买牛奶和水果",
    detail: item.detail,
    course_id: item.course_id,
    start_at: item.start_at,
    occurrence_start_at: item.occurrence_start_at,
    occurrence_end_at: item.occurrence_end_at,
    due_at: item.due_at,
    reminder_level: item.reminder_level,
  };
}

it("queues only the fields the edit actually changed", async () => {
  const { manager, repo, item } = await seedItem();
  const updated = await manager.updateItem(item.id, fullSnapshot(item));
  expect(updated.title).toBe("买牛奶和水果");

  const mutation = (await repo.pendingMutations()).find(
    (value) => value.entity_id === item.id && value.operation === "UPDATE",
  );
  expect(mutation).toBeTruthy();
  expect(Object.keys(mutation!.changed_fields)).toEqual(["title"]);
  expect(mutation!.base_version).toBe(item.row_version);
});

it("saves without a mutation when no field actually changed", async () => {
  const { manager, repo, item } = await seedItem();
  const before = (await repo.pendingMutations()).length;
  const unchanged = { ...item, title: item.title };

  const saved = await manager.updateItem(item.id, {
    title: unchanged.title,
    detail: item.detail,
    course_id: item.course_id,
    start_at: item.start_at,
    occurrence_start_at: item.occurrence_start_at,
    occurrence_end_at: item.occurrence_end_at,
    due_at: item.due_at,
    reminder_level: item.reminder_level,
  });

  expect(saved.row_version).toBe(item.row_version);
  expect((await repo.pendingMutations()).length).toBe(before);
});
