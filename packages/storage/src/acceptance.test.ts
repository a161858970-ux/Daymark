import "fake-indexeddb/auto";
import { afterEach, expect, it } from "vitest";
import {
  CourseManager,
  deriveReminderSchedule,
  type ReminderPolicy,
  type ReminderWindow,
  type Runtime,
} from "@course-manager/application";
import { projectItemToCalendar } from "@course-manager/domain";
import { CourseManagerDb, DexieLocalRepository } from "./index.js";

const databases: CourseManagerDb[] = [];
const hour = 60 * 60 * 1000;
const policy: ReminderPolicy = {
  version: "acceptance-only",
  levels: {
    NORMAL: {
      due_leads_ms: [2 * hour, hour],
      occurrence_leads_ms: [hour],
      overdue_interval_ms: 4 * hour,
      occurrence_after_interval_ms: 8 * hour,
    },
    HIGH: {
      due_leads_ms: [3 * hour, 2 * hour, hour],
      occurrence_leads_ms: [2 * hour, hour],
      overdue_interval_ms: 2 * hour,
      occurrence_after_interval_ms: 6 * hour,
    },
  },
  start_offset_ms: 0,
  max_per_local_day: 20,
  dedup_window_ms: 10 * 60 * 1000,
};
const reminderWindow: ReminderWindow = {
  from: "2026-09-22T08:00:00.000Z",
  to: "2026-09-25T08:00:00.000Z",
  nextAllowedTime: (value) => value,
  localDayKey: (value) => value.slice(0, 10),
};

function setup() {
  const name = `acceptance-${crypto.randomUUID()}`;
  const db = new CourseManagerDb(name);
  databases.push(db);
  const repo = new DexieLocalRepository(db);
  let now = "2026-09-22T08:00:00.000Z";
  const runtime: Runtime = {
    now: () => now,
    id: () => crypto.randomUUID(),
  };
  return {
    name,
    db,
    repo,
    manager: new CourseManager(repo, runtime),
    setNow: (value: string) => {
      now = value;
    },
  };
}

afterEach(async () => {
  for (const db of databases.splice(0)) {
    db.close();
    await db.delete();
  }
});

it("T-AI-004/005/010 and T-REC-004 keep deferred ambiguity across restart until explicit deletion", async () => {
  const { name, db, manager } = setup();
  const raw = await manager.capture("第四周前交作业");
  expect(await manager.processClearCapture(raw.id)).toBeNull();
  await manager.deferRawCapture(raw.id);
  expect((await manager.unresolvedCaptures()).map((value) => value.id)).toEqual([
    raw.id,
  ]);

  db.close();
  const reopened = new CourseManagerDb(name);
  databases.push(reopened);
  const resumed = new CourseManager(new DexieLocalRepository(reopened));
  expect((await resumed.unresolvedCaptures()).map((value) => value.id)).toEqual([
    raw.id,
  ]);
  expect(await reopened.items.count()).toBe(0);

  await resumed.deleteUnresolvedCapture(raw.id);
  expect(await resumed.unresolvedCaptures()).toEqual([]);
  expect((await reopened.raw_captures.get(raw.id))?.deleted_at).toBeTruthy();
  expect(await reopened.items.count()).toBe(0);
});

it("T-ITEM-001..007 keeps one canonical Item through capture, projections, reminders, edit, complete, delete, and Undo", async () => {
  const { db, repo, manager, setNow } = setup();
  const semester = await manager.createSemester(
    "2026 秋季学期",
    "2026-09-01",
    "2026-12-31",
  );
  const course = await manager.createCourse("环境经济学", semester.id);

  const noTimeRaw = await manager.capture(
    "找学姐要环境经济学笔记",
    "COURSE_ITEM",
    course.id,
  );
  const noTime = await manager.processClearCapture(noTimeRaw.id);
  expect(noTime).toMatchObject({
    status: "INCOMPLETE",
    course_id: course.id,
    start_at: null,
    occurrence_start_at: null,
    occurrence_end_at: null,
    due_at: null,
  });
  expect(
    (await manager.overview("2026-09-22", reminderWindow.from)).find(
      (item) => item.id === noTime!.id,
    ),
  ).toEqual(noTime);
  expect(
    (await manager.courseItems(course.id, reminderWindow.from)).find(
      (item) => item.id === noTime!.id,
    ),
  ).toEqual(noTime);
  expect((await manager.calendarItems()).map((item) => item.id)).not.toContain(
    noTime!.id,
  );
  expect(deriveReminderSchedule([noTime!], policy, reminderWindow)).toEqual([]);

  const timedRaw = await manager.capture(
    "管理学原理，第一次作业，9月28日前提交",
  );
  expect(await manager.processClearCapture(timedRaw.id)).toBeNull();
  const timed = await manager.resolveRawCapture(timedRaw.id, {
    kind: "ITEM",
    title: "第一次作业",
    detail: null,
    course_id: course.id,
    start_at: null,
    occurrence_start_at: null,
    occurrence_end_at: null,
    due_at: "2026-09-23T12:00:00.000Z",
    reminder_level: "NORMAL",
  });
  expect(projectItemToCalendar(timed)).toMatchObject({ item_id: timed.id });
  expect((await manager.calendarItems()).map((item) => item.id)).toContain(
    timed.id,
  );
  expect(
    deriveReminderSchedule([timed], policy, reminderWindow).length,
  ).toBeGreaterThan(1);

  const createdAt = timed.created_at;
  setNow("2026-09-22T09:00:00.000Z");
  const edited = await manager.updateItem(timed.id, {
    detail: "作业要求在课程群",
    due_at: "2026-09-24T12:00:00.000Z",
  });
  expect(edited).toMatchObject({ id: timed.id, created_at: createdAt });
  for (const projection of [
    await manager.overview("2026-09-22", reminderWindow.from),
    await manager.courseItems(course.id, reminderWindow.from),
    await manager.calendarItems(),
  ])
    expect(projection.find((item) => item.id === timed.id)).toMatchObject({
      id: timed.id,
      detail: "作业要求在课程群",
      due_at: "2026-09-24T12:00:00.000Z",
    });

  const completed = await manager.completeItem(timed.id);
  expect(completed.status).toBe("COMPLETE");
  expect(
    (await manager.overview("2026-09-22", reminderWindow.from)).at(-1),
  ).toMatchObject({ id: timed.id, status: "COMPLETE" });
  expect(
    (await manager.calendarItems()).find((item) => item.id === timed.id),
  ).toMatchObject({ id: timed.id, status: "COMPLETE" });
  expect(deriveReminderSchedule([completed], policy, reminderWindow)).toEqual(
    [],
  );

  const restored = await manager.restoreItem(timed.id);
  expect(restored).toMatchObject({ id: timed.id, status: "INCOMPLETE" });
  expect(
    deriveReminderSchedule([restored], policy, reminderWindow).length,
  ).toBeGreaterThan(1);

  const outputsBeforeDelete = await repo.listOutputs(timedRaw.id);
  const deleted = await manager.deleteItem(timed.id);
  expect(deleted.item).toMatchObject({ id: timed.id });
  expect((await manager.listItems()).map((item) => item.id)).not.toContain(
    timed.id,
  );
  expect((await manager.calendarItems()).map((item) => item.id)).not.toContain(
    timed.id,
  );
  expect((await repo.getRawCapture(timedRaw.id))?.raw_text).toBe(
    "管理学原理，第一次作业，9月28日前提交",
  );
  expect(
    deriveReminderSchedule([deleted.item], policy, reminderWindow),
  ).toEqual([]);
  expect(
    (await repo.pendingMutations()).some(
      (mutation) =>
        mutation.entity_type === "ITEM" &&
        mutation.entity_id === timed.id &&
        mutation.operation === "DELETE",
    ),
  ).toBe(true);

  const undone = await manager.undoDelete(timed.id, deleted.token);
  expect(undone).toMatchObject({ id: timed.id, deleted_at: null });
  expect(await repo.listOutputs(timedRaw.id)).toEqual(outputsBeforeDelete);
  expect(await db.items.get(timed.id)).toMatchObject({ id: timed.id });
});
