import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import {
  Daymark,
  preprocessCapture,
  resolveItemReminderTimes,
  type Runtime,
} from "@daymark/application";
import {
  projectItemToCalendar,
  semesterWeekForDate,
  type Item,
} from "@daymark/domain";
import { DaymarkDb, DexieLocalRepository } from "./index.js";

const databases: DaymarkDb[] = [];

function setup() {
  const name = `daymark-test-${crypto.randomUUID()}`;
  const db = new DaymarkDb(name);
  databases.push(db);
  const repo = new DexieLocalRepository(db);
  let time = "2026-09-22T08:00:00.000Z";
  const runtime: Runtime = { now: () => time, id: () => crypto.randomUUID() };
  return {
    name,
    db,
    repo,
    manager: new Daymark(repo, runtime),
    setTime: (value: string) => {
      time = value;
    },
  };
}

afterEach(async () => {
  for (const db of databases.splice(0)) {
    db.close();
    await db.delete();
  }
});

it("preprocesses clear input without changing raw text or asking AI", () => {
  const rawText = "  找学姐要笔记   ";
  expect(
    preprocessCapture({
      rawText,
      source: "QUICK_CAPTURE",
      contextCourseId: null,
      courses: [],
      capturedAt: "2026-09-22T08:00:00.000Z",
      timeZone: "UTC",
    }),
  ).toMatchObject({ classification: "ITEM", title: "找学姐要笔记" });
  expect(rawText).toBe("  找学姐要笔记   ");
  expect(
    preprocessCapture({
      rawText: "找学姐要笔记，提交报告",
      source: "QUICK_CAPTURE",
      contextCourseId: null,
      courses: [],
      capturedAt: "2026-09-22T08:00:00.000Z",
      timeZone: "UTC",
    }),
  ).toMatchObject({
    classification: "UNRESOLVED",
    unresolvedReason: "可能包含多个事项",
    splitCandidates: ["找学姐要笔记", "提交报告"],
  });
  const course = {
    id: crypto.randomUUID(),
    owner_id: crypto.randomUUID(),
    semester_id: null,
    name: "环境经济学",
    instructor: null,
    created_at: "2026-09-22T08:00:00.000Z",
    updated_at: "2026-09-22T08:00:00.000Z",
    deleted_at: null,
    row_version: 1,
  };
  expect(
    preprocessCapture({
      rawText: "老师说下周讲第三章",
      source: "COURSE_INFORMATION",
      contextCourseId: course.id,
      courses: [course],
      capturedAt: "2026-09-22T08:00:00.000Z",
      timeZone: "UTC",
    }),
  ).toMatchObject({ classification: "COURSE_INFORMATION" });
});

it("keeps one or splits only according to the recorded user decision", async () => {
  const { manager, repo, db } = setup();
  const one = await manager.capture("找学姐要笔记，提交报告");
  expect(await manager.processClearCapture(one.id)).toBeNull();
  const singleResolution = {
    kind: "ITEM" as const,
    title: one.raw_text,
    detail: null,
    course_id: null,
    start_at: null,
    start_date: null,
    occurrence_start_at: null,
    occurrence_start_date: null,
    occurrence_end_at: null,
    occurrence_end_date: null,
    due_at: null,
    due_date: null,
    time_zone: "UTC",
    reminder_level: "NORMAL" as const,
  };
  const single = await manager.resolveRawCapture(
    one.id,
    singleResolution,
    "KEEP_ONE",
  );
  expect(single.raw_capture_id).toBe(one.id);
  expect(await repo.listOutputs(one.id)).toHaveLength(1);
  expect((await repo.listDecisions(one.id)).at(-1)?.decision_type).toBe(
    "KEEP_ONE",
  );

  const splitRaw = await manager.capture("找学姐要笔记，提交报告");
  expect(await manager.processClearCapture(splitRaw.id)).toBeNull();
  const resolutions = [
    { ...singleResolution, title: "找学姐要笔记" },
    { ...singleResolution, title: "提交报告" },
  ];
  const items = await manager.resolveSplitCapture(splitRaw.id, resolutions);
  expect(items).toHaveLength(2);
  expect(items.map((item) => item.raw_capture_id)).toEqual([
    splitRaw.id,
    splitRaw.id,
  ]);
  expect(await repo.listOutputs(splitRaw.id)).toHaveLength(2);
  expect((await repo.listDecisions(splitRaw.id)).at(-1)?.decision_type).toBe(
    "SPLIT",
  );
  expect(
    (await manager.resolveSplitCapture(splitRaw.id, resolutions)).map(
      (item) => item.id,
    ),
  ).toEqual(items.map((item) => item.id));
  expect(await db.items.count()).toBe(3);
  await expect(
    manager.resolveSplitCapture(splitRaw.id, [...resolutions].reverse()),
  ).rejects.toThrow("already been resolved");
});

describe("local-first persistence and Item identity", () => {
  it("requires an explicit Course deletion strategy and preserves RawCapture", async () => {
    const { manager, repo, db } = setup();
    const keepCourse = await manager.createCourse("统计学");
    const keepRaw = await manager.capture(
      "准备讲稿",
      "COURSE_ITEM",
      keepCourse.id,
    );
    const keepItem = await manager.processClearCapture(keepRaw.id);
    await expect(
      manager.deleteCourseWithStrategy(
        keepCourse.id,
        "UNLINK_ASSOCIATED_ITEMS",
        [],
      ),
    ).rejects.toThrow(/items changed/);
    const unlinked = await manager.deleteCourseWithStrategy(
      keepCourse.id,
      "UNLINK_ASSOCIATED_ITEMS",
      [keepItem!.id],
    );
    expect(unlinked.items[0]).toMatchObject({
      id: keepItem!.id,
      course_id: null,
      deleted_at: null,
    });
    expect(
      (await manager.listCourses()).some(
        (course) => course.id === keepCourse.id,
      ),
    ).toBe(false);
    expect(
      (await manager.overview("2026-09-22", "2026-09-22T08:00:00Z")).map(
        (item) => item.id,
      ),
    ).toContain(keepItem!.id);
    expect((await repo.getRawCapture(keepRaw.id))?.raw_text).toBe("准备讲稿");

    const removeCourse = await manager.createCourse("经济法");
    const removeRaw = await manager.capture(
      "交论文",
      "COURSE_ITEM",
      removeCourse.id,
    );
    const removeItem = await manager.processClearCapture(removeRaw.id);
    const deleted = await manager.deleteCourseWithStrategy(
      removeCourse.id,
      "DELETE_ASSOCIATED_ITEMS",
      [removeItem!.id],
    );
    expect(deleted.items[0]?.deleted_at).not.toBeNull();
    expect(
      (await manager.overview("2026-09-22", "2026-09-22T08:00:00Z")).map(
        (item) => item.id,
      ),
    ).not.toContain(removeItem!.id);
    expect((await repo.getRawCapture(removeRaw.id))?.raw_text).toBe("交论文");
    expect(
      (await new DexieLocalRepository(db).pendingMutations()).filter(
        (value) =>
          value.entity_type === "COURSE" && value.operation === "DELETE",
      ),
    ).toHaveLength(2);
  });

  it("replaces CourseSchedule atomically without projecting classes into Calendar", async () => {
    const { manager, db } = setup();
    const course = await manager.createCourse("统计学");
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
    expect(first).toMatchObject({
      course_id: course.id,
      start_time: "14:00:00",
    });
    expect(await manager.calendarItems()).toEqual([]);
    await expect(
      manager.replaceCourseSchedules(course.id, [
        { ...fields, end_time: "13:00" },
      ]),
    ).rejects.toThrow(/schedule/);
    expect(
      (await manager.courseSchedules(course.id)).map((value) => value.id),
    ).toEqual([first!.id]);
    const [second] = await manager.replaceCourseSchedules(course.id, [
      { ...fields, weekday: 4 },
    ]);
    expect(
      (await manager.courseSchedules(course.id)).map((value) => value.id),
    ).toEqual([second!.id]);
    expect(
      (await db.course_schedules.get(first!.id))?.deleted_at,
    ).not.toBeNull();
    expect(await manager.calendarItems()).toEqual([]);
    const replacements = (
      await new DexieLocalRepository(db).pendingMutations()
    ).filter((value) => value.entity_type === "COURSE_SCHEDULE_COLLECTION");
    expect(replacements.map((value) => value.operation)).toEqual([
      "UPDATE",
      "UPDATE",
    ]);
    expect(replacements[0]?.changed_fields).toMatchObject({
      previous_collection: [],
      collection: [{ id: first!.id, course_id: course.id }],
    });
    expect(replacements[1]?.changed_fields).toMatchObject({
      previous_collection: [{ id: first!.id, course_id: course.id }],
      collection: [{ id: second!.id, course_id: course.id }],
    });
  });

  it("binds Courses to active Semester and keeps historical completed Items out of daily Overview", async () => {
    const { manager } = setup();
    const spring = await manager.createSemester(
      "2026 春季学期",
      "2026-02-01",
      "2026-06-30",
    );
    const autumn = await manager.createSemester(
      "2026 秋季学期",
      "2026-09-01",
      "2026-12-31",
    );
    const current = await manager.createCourse("环境经济学");
    const prior = await manager.createCourse("经济法", spring.id);
    expect(current.semester_id).toBe(autumn.id);
    expect(prior.semester_id).toBe(spring.id);
    const currentRaw = await manager.capture(
      "找学姐要笔记",
      "COURSE_ITEM",
      current.id,
    );
    const currentItem = await manager.processClearCapture(currentRaw.id);
    const priorRaw = await manager.capture("交论文", "COURSE_ITEM", prior.id);
    const priorItem = await manager.processClearCapture(priorRaw.id);
    const oldDoneRaw = await manager.capture("看教材", "COURSE_ITEM", prior.id);
    const oldDone = await manager.processClearCapture(oldDoneRaw.id);
    await manager.completeItem(oldDone!.id);
    const freeRaw = await manager.capture("整理文件");
    const freeItem = await manager.processClearCapture(freeRaw.id);
    const daily = await manager.overview("2026-09-22", "2026-09-22T08:00:00Z");
    expect(daily.map((item) => item.id)).toEqual(
      expect.arrayContaining([currentItem!.id, priorItem!.id, freeItem!.id]),
    );
    expect(daily.map((item) => item.id)).not.toContain(oldDone!.id);
    const historical = await manager.overview(
      "2026-09-22",
      "2026-09-22T08:00:00Z",
      spring.id,
    );
    expect(historical.map((item) => item.id)).toEqual(
      expect.arrayContaining([priorItem!.id, oldDone!.id, freeItem!.id]),
    );
    expect(historical.map((item) => item.id)).not.toContain(currentItem!.id);
    const weeks = await manager.replaceSemesterWeeks(autumn.id, [
      { week_number: 1, start_date: "2026-09-01", end_date: "2026-09-06" },
      { week_number: 2, start_date: "2026-09-07", end_date: "2026-09-13" },
    ]);
    expect(semesterWeekForDate("2026-09-08", autumn.id, weeks)).toBe(2);
    await expect(
      manager.replaceSemesterWeeks(autumn.id, [
        { week_number: 1, start_date: "2026-09-01", end_date: "2026-09-08" },
        { week_number: 2, start_date: "2026-09-08", end_date: "2026-09-14" },
      ]),
    ).rejects.toThrow(/week mapping/);
  });

  it("requires explicit same-course confirmation before inheriting prior CourseInformation", async () => {
    const { manager } = setup();
    const older = await manager.createSemester(
      "2025 秋季",
      "2025-09-01",
      "2025-12-31",
    );
    const previous = await manager.createSemester(
      "2026 春季",
      "2026-02-01",
      "2026-06-30",
    );
    const current = await manager.createSemester(
      "2026 秋季",
      "2026-09-01",
      "2026-12-31",
    );
    await manager.createCourse("环境经济学", older.id);
    const prior = await manager.createCourse("环境经济学", previous.id);
    await manager.addCourseInformation(prior.id, "教材是第四版");
    const raw = await manager.capture("找学姐要笔记", "COURSE_ITEM", prior.id);
    await manager.processClearCapture(raw.id);
    expect(
      (await manager.priorCourseCandidate("环境经济学", current.id))?.id,
    ).toBe(prior.id);
    expect(await manager.priorCourseCandidate("经济法", current.id)).toBeNull();
    const separate = await manager.createCourse("环境经济学", current.id);
    expect(await manager.courseInformation(separate.id)).toEqual([]);
    const inherited = await manager.createCourseWithInheritance(
      "环境经济学",
      current.id,
      prior.id,
    );
    expect(inherited.id).not.toBe(prior.id);
    expect(
      (await manager.courseInformation(inherited.id)).map(
        (value) => value.content,
      ),
    ).toEqual(["教材是第四版"]);
    expect(
      await manager.courseItems(inherited.id, "2026-09-22T08:00:00Z"),
    ).toEqual([]);
    await expect(
      manager.createCourseWithInheritance("经济法", current.id, prior.id),
    ).rejects.toThrow(/candidate/);
  });
  it("commits original RawCapture before processing and survives reopen", async () => {
    const { name, db, repo, manager } = setup();
    const rawText = "  找学姐要环境经济学笔记  ";
    const capture = await manager.capture(rawText);
    expect((await repo.getRawCapture(capture.id))?.raw_text).toBe(rawText);
    expect(await db.outbox_mutations.count()).toBe(1);

    db.close();
    const reopened = new DaymarkDb(name);
    databases.push(reopened);
    const reopenedRepo = new DexieLocalRepository(reopened);
    expect((await reopenedRepo.getRawCapture(capture.id))?.raw_text).toBe(
      rawText,
    );
    const processed = await new Daymark(reopenedRepo).processClearCapture(
      capture.id,
    );
    expect(processed?.status).toBe("INCOMPLETE");
    expect(
      (await reopenedRepo.listOutputs(capture.id)).map(
        (output) => output.object_id,
      ),
    ).toEqual([processed?.id]);
    expect((await reopenedRepo.getRawCapture(capture.id))?.raw_text).toBe(
      rawText,
    );
    expect(
      (await new Daymark(reopenedRepo).processClearCapture(capture.id))?.id,
    ).toBe(processed?.id);
    expect(await reopenedRepo.listOutputs(capture.id)).toHaveLength(1);
  });

  it("uses one Item across Overview and Course and keeps raw provenance after edit/delete", async () => {
    const { repo, manager } = setup();
    const course = await manager.createCourse("环境经济学");
    const capture = await manager.capture("找学姐要笔记", "COURSE_ITEM");
    const created = await manager.processClearCapture(capture.id, course.id);
    expect(created).not.toBeNull();
    const item = created!;
    expect(
      (await manager.overview("2026-09-22", "2026-09-22T08:00:00.000Z")).map(
        (value) => value.id,
      ),
    ).toContain(item.id);
    expect(
      (await manager.courseItems(course.id, "2026-09-22T08:00:00.000Z")).map(
        (value) => value.id,
      ),
    ).toContain(item.id);
    const edited = await manager.updateItem(item.id, {
      title: "找学姐要课程笔记",
    });
    expect(edited.id).toBe(item.id);
    expect(edited.created_at).toBe(item.created_at);
    expect((await repo.getRawCapture(capture.id))?.raw_text).toBe(
      "找学姐要笔记",
    );

    const timed = await manager.updateItem(item.id, {
      start_at: "2026-09-23T08:00:00Z",
      due_at: "2026-09-27T12:00:00Z",
    });
    expect(projectItemToCalendar(timed)).toEqual({
      item_id: item.id,
      start: "2026-09-23T08:00:00Z",
      end: "2026-09-27T12:00:00Z",
      kind: "RANGE",
      all_day: false,
      calendar_start: null,
      calendar_end: null,
    });

    const completed = await manager.completeItem(item.id);
    expect(completed.status).toBe("COMPLETE");
    expect(
      (await manager.courseItems(course.id, "2026-09-22T08:00:00.000Z")).find(
        (value) => value.id === item.id,
      )?.status,
    ).toBe("COMPLETE");
    const deleted = await manager.deleteItem(item.id);
    expect(
      (await manager.overview("2026-09-22", "2026-09-22T08:00:00.000Z")).some(
        (value) => value.id === item.id,
      ),
    ).toBe(false);
    expect((await repo.getRawCapture(capture.id))?.raw_text).toBe(
      "找学姐要笔记",
    );
    const restored = await manager.undoDelete(item.id, deleted.token);
    expect(restored.id).toBe(item.id);
    expect(restored.status).toBe("COMPLETE");
    await expect(manager.undoDelete(item.id, deleted.token)).rejects.toThrow();
  });

  it("rejects delete Undo after the bounded window", async () => {
    const { manager, setTime } = setup();
    const capture = await manager.capture("准备讲稿");
    const item = await manager.processClearCapture(capture.id);
    const deleted = await manager.deleteItem(item!.id);
    setTime("2026-09-22T08:00:11.000Z");
    await expect(manager.undoDelete(item!.id, deleted.token)).rejects.toThrow(
      "expired",
    );
  });

  it("creates a clear item from time-bearing text and never drops facts", async () => {
    const { manager, repo } = setup();
    const capture = await manager.capture("提交课程报告，9月28日前");
    // Spec 22 §2.1: a clear ITEM with a trusted date is not blocked by time.
    const item = await manager.processClearCapture(capture.id);
    expect(item).not.toBeNull();
    expect((item as Item).title).toContain("提交课程报告");
    expect((item as Item).due_date).toBe("2026-09-27"); // 9月28日前 → previous day
    expect((await repo.getRawCapture(capture.id))?.raw_text).toBe(
      "提交课程报告，9月28日前",
    );
    expect(await repo.listOutputs(capture.id)).toHaveLength(1);
  });

  it("stores course information independently of Item status and preserves edits", async () => {
    const { manager, db } = setup();
    const course = await manager.createCourse("环境经济学");
    const information = await manager.addCourseInformation(
      course.id,
      "期末会画重点",
    );
    expect(
      (await manager.courseInformation(course.id)).map(
        (value) => value.content,
      ),
    ).toEqual(["期末会画重点"]);
    expect(await db.items.count()).toBe(0);
    await manager.updateCourseInformation(information.id, "期末考试会画重点");
    expect((await manager.courseInformation(course.id))[0]?.content).toBe(
      "期末考试会画重点",
    );
    await manager.deleteCourseInformation(information.id);
    expect(await manager.courseInformation(course.id)).toHaveLength(0);
    expect(
      (await db.course_information.get(information.id))?.deleted_at,
    ).not.toBeNull();
  });

  it("creates, lists and deletes a symmetric Item association without state propagation", async () => {
    const { manager, repo } = setup();
    const firstRaw = await manager.capture("准备课堂演讲");
    const secondRaw = await manager.capture("准备演讲幻灯片");
    const first = await manager.processClearCapture(firstRaw.id);
    const second = await manager.processClearCapture(secondRaw.id);
    expect(first && "status" in first ? first : null).toBeTruthy();
    expect(second && "status" in second ? second : null).toBeTruthy();
    const association = await manager.associateItems(
      (second as Item).id,
      (first as Item).id,
    );
    expect(association.item_id_a < association.item_id_b).toBe(true);
    expect(
      await manager.associateItems((first as Item).id, (second as Item).id),
    ).toEqual(association);
    expect(await manager.itemAssociations((first as Item).id)).toEqual([
      association,
    ]);
    await manager.completeItem((first as Item).id);
    expect((await manager.getItem((second as Item).id))?.status).toBe(
      "INCOMPLETE",
    );
    await manager.deleteItemAssociation(association.id);
    expect(await manager.itemAssociations((first as Item).id)).toEqual([]);
    expect((await manager.getItem((first as Item).id))?.status).toBe(
      "COMPLETE",
    );
    expect(
      (await repo.pendingMutations())
        .filter((value) => value.entity_type === "ITEM_ASSOCIATION")
        .map((value) => value.operation),
    ).toEqual(["CREATE", "DELETE"]);
  });

  it("uses a unique exact course name in quick capture and asks when multiple course instances match", async () => {
    const { manager } = setup();
    const course = await manager.createCourse("环境经济学");
    const first = await manager.capture("环境经济学，准备讲稿");
    const item = await manager.processClearCapture(first.id);
    expect(item?.course_id).toBe(course.id);
    expect(item?.title).toBe("准备讲稿");
    await manager.createCourse("环境经济学");
    const second = await manager.capture("环境经济学，准备论文");
    expect(await manager.processClearCapture(second.id)).toBeNull();
    expect(
      (await manager.unresolvedCaptures()).find(
        (value) => value.id === second.id,
      )?.unresolved_reason,
    ).toBe("需要确认所属课程");
  });

  it("classifies clear course information without creating an Item", async () => {
    const { manager, db, repo } = setup();
    const course = await manager.createCourse("环境经济学");
    const raw = await manager.capture("环境经济学，老师说期末会画重点");
    const output = await manager.processClearCapture(raw.id);
    expect(output).toMatchObject({
      course_id: course.id,
      content: "老师说期末会画重点",
    });
    expect(await db.items.count()).toBe(0);
    expect((await repo.listOutputs(raw.id))[0]).toMatchObject({
      object_type: "COURSE_INFORMATION",
      object_id: output?.id,
    });
    expect((await repo.getRawCapture(raw.id))?.raw_text).toBe(
      "环境经济学，老师说期末会画重点",
    );
  });

  it("honors the explicit Course Item entry point over wording that resembles information", async () => {
    const { manager, db } = setup();
    const course = await manager.createCourse("环境经济学");
    const raw = await manager.capture(
      "老师说期末会画重点",
      "COURSE_ITEM",
      course.id,
    );
    const output = await manager.processClearCapture(raw.id);
    expect(output).toMatchObject({
      course_id: course.id,
      title: "老师说期末会画重点",
      status: "INCOMPLETE",
    });
    expect(await db.course_information.count()).toBe(0);
  });

  it("resumes a course-context capture after a restart without guessing the course", async () => {
    const { manager, db, name } = setup();
    const course = await manager.createCourse("经济法");
    const raw = await manager.capture("准备期末讲稿", "COURSE_ITEM", course.id);
    db.close();
    const reopened = new DaymarkDb(name);
    databases.push(reopened);
    const resumed = new Daymark(new DexieLocalRepository(reopened));
    await resumed.recoverPendingCaptures();
    expect((await reopened.items.toArray())[0]?.course_id).toBe(course.id);
    expect((await reopened.raw_captures.get(raw.id))?.processing_status).toBe(
      "RESOLVED",
    );
    await resumed.recoverPendingCaptures();
    expect(await reopened.items.count()).toBe(1);
  });

  it("records a clear ITEM for 第四周前 without inventing a date", async () => {
    const { manager, db, repo } = setup();
    const raw = await manager.capture("第四周前交作业");
    // Clear type; missing SemesterWeek mapping must not block the Item.
    const created = await manager.processClearCapture(raw.id);
    expect(created).not.toBeNull();
    expect((created as Item).title).toContain("第四周");
    expect((created as Item).due_at).toBeNull();
    expect((created as Item).due_date).toBeNull();
    expect((await repo.getRawCapture(raw.id))?.raw_text).toBe("第四周前交作业");
    expect(await db.raw_capture_decisions.count()).toBe(0);
  });

  it("records a user's explicit resolution and preserves time", async () => {
    const { manager, db, repo } = setup();
    const raw = await manager.capture("老师让我们关注第三章");
    expect(await manager.processClearCapture(raw.id)).toBeNull();
    await manager.resolveRawCapture(raw.id, {
      kind: "ITEM",
      title: "关注第三章",
      detail: null,
      course_id: null,
      start_at: null,
      start_date: null,
      occurrence_start_at: null,
      occurrence_start_date: null,
      occurrence_end_at: null,
      occurrence_end_date: null,
      due_at: "2026-10-09T12:00:00.000Z",
      due_date: null,
      time_zone: "UTC",
      reminder_level: "NORMAL",
    });
    expect(await db.raw_capture_decisions.count()).toBe(1);
    expect(await repo.listOutputs(raw.id)).toHaveLength(1);
    await expect(
      manager.resolveRawCapture(raw.id, {
        kind: "COURSE_INFORMATION",
        course_id: crypto.randomUUID(),
        content: "重复",
      }),
    ).rejects.toThrow("already been resolved");
  });
});

it("keeps a schedule with no clock time and rejects one-sided times", async () => {
  const { manager } = setup();
  const course = await manager.createCourse("统计学");
  const [undated] = await manager.replaceCourseSchedules(course.id, [
    {
      weekday: 5,
      start_time: null,
      end_time: null,
      week_start: null,
      week_end: null,
      classroom: null,
      stage_label: "12-13节",
    },
  ]);
  expect(undated).toMatchObject({
    start_time: null,
    end_time: null,
    stage_label: "12-13节",
  });
  await expect(
    manager.replaceCourseSchedules(course.id, [
      {
        weekday: 5,
        start_time: "14:00",
        end_time: null,
        week_start: null,
        week_end: null,
        classroom: null,
        stage_label: null,
      },
    ]),
  ).rejects.toThrow(/schedule/);
});

it("removes a Semester with its courses locally and queues the cascade for sync", async () => {
  const { manager, repo, db } = setup();
  const doomed = await manager.createSemester(
    "删除测试学期",
    "2026-09-01",
    "2027-01-31",
  );
  const kept = await manager.createSemester(
    "保留学期",
    "2026-09-01",
    "2027-01-31",
  );
  const first = await manager.createCourse("经济法", doomed.id);
  const second = await manager.createCourse("线性代数", doomed.id);
  const survivor = await manager.createCourse("统计学", kept.id);
  const raw = await manager.capture("交论文", "COURSE_ITEM", first.id);
  const removedItem = await manager.processClearCapture(raw.id);
  const keptRaw = await manager.capture("复习", "COURSE_ITEM", survivor.id);
  const keptItem = await manager.processClearCapture(keptRaw.id);
  expect(removedItem).toBeTruthy();

  const result = await manager.deleteSemester(doomed.id);
  expect(result.course_count).toBe(2);

  expect(
    (await manager.listSemesters()).map((entry) => entry.id),
  ).not.toContain(doomed.id);
  expect((await db.semesters.get(doomed.id))?.deleted_at).not.toBeNull();
  expect((await db.semesters.get(kept.id))?.deleted_at).toBeNull();
  expect((await db.courses.get(first.id))?.deleted_at).not.toBeNull();
  expect((await db.courses.get(second.id))?.deleted_at).not.toBeNull();
  expect((await db.courses.get(survivor.id))?.deleted_at).toBeNull();
  expect((await db.items.get(removedItem!.id))?.deleted_at).not.toBeNull();
  expect((await db.items.get(keptItem!.id))?.deleted_at).toBeNull();

  const pending = await repo.pendingMutations();
  const semesterDelete = pending.find(
    (mutation) =>
      mutation.entity_type === "SEMESTER" && mutation.operation === "DELETE",
  );
  expect(semesterDelete?.entity_id).toBe(doomed.id);
  expect(semesterDelete?.base_version).toBe(1);
  expect(semesterDelete?.changed_fields).toMatchObject({
    deleted_at: expect.any(String),
    updated_at: expect.any(String),
  });
  const courseDeletes = pending.filter(
    (mutation) =>
      mutation.entity_type === "COURSE" && mutation.operation === "DELETE",
  );
  expect(courseDeletes.map((mutation) => mutation.entity_id).sort()).toEqual(
    [first.id, second.id].sort(),
  );
  for (const mutation of courseDeletes) {
    expect(mutation.changed_fields).toMatchObject({
      strategy: "DELETE_ASSOCIATED_ITEMS",
      deleted_at: expect.any(String),
    });
    expect(
      (mutation.changed_fields as { item_versions: unknown[] }).item_versions,
    ).toBeInstanceOf(Array);
  }

  await expect(manager.deleteSemester(doomed.id)).rejects.toThrow(
    "Semester not found",
  );
});

describe("NL capture e2e (processClearCapture)", () => {
  function setupWithZone(zone: string | null) {
    const name = `daymark-test-${crypto.randomUUID()}`;
    const db = new DaymarkDb(name);
    databases.push(db);
    const repo = new DexieLocalRepository(db);
    let time = "2026-10-09T02:00:00.000Z";
    const runtime: Runtime = {
      now: () => time,
      id: () => crypto.randomUUID(),
      timeZone: () => zone ?? "Asia/Shanghai",
    };
    return {
      db,
      repo,
      manager: new Daymark(repo, runtime),
      setTime: (value: string) => {
        time = value;
      },
    };
  }

  it("creates an Item for 下周三课堂展示 with DATE occurrence, no extra prompt", async () => {
    const { manager, repo } = setupWithZone("Asia/Shanghai");
    const raw = await manager.capture(
      "下周三课堂展示",
      "QUICK_CAPTURE",
      null,
      "Asia/Shanghai",
    );
    expect(raw.captured_tz).toBe("Asia/Shanghai");
    const item = (await manager.processClearCapture(raw.id)) as Item;
    expect(item).toBeTruthy();
    expect(item.title).toBe("课堂展示");
    expect(item.occurrence_start_date).toBe("2026-10-14");
    expect(item.occurrence_start_at).toBeNull();
    expect(item.time_zone).toBe("Asia/Shanghai");
    expect((await repo.getRawCapture(raw.id))?.raw_text).toBe("下周三课堂展示");
    expect((await repo.getRawCapture(raw.id))?.processing_status).toBe(
      "RESOLVED",
    );
  });

  it("keeps 老师让我们关注一下第三章 unresolved", async () => {
    const { manager } = setupWithZone("Asia/Shanghai");
    const raw = await manager.capture(
      "老师让我们关注一下第三章",
      "QUICK_CAPTURE",
      null,
      "Asia/Shanghai",
    );
    expect(await manager.processClearCapture(raw.id)).toBeNull();
    expect(
      (await manager.unresolvedCaptures()).map((value) => value.id),
    ).toEqual([raw.id]);
  });

  it("historical no-tz absolute DATE gets device time_zone for reminders", async () => {
    const { manager, repo } = setupWithZone("Asia/Tokyo");
    // Simulate a historical row: captured_tz missing (null).
    const raw = await manager.capture("2026年10月12日截止");
    await repo.putRawCapture({ ...raw, captured_tz: null });
    const item = (await manager.processClearCapture(raw.id)) as Item;
    expect(item.due_date).toBe("2026-10-12");
    expect(item.due_at).toBeNull();
    // Item.time_zone uses the device zone so day-end reminders work.
    expect(item.time_zone).toBe("Asia/Tokyo");
    const times = resolveItemReminderTimes(item);
    // End of 2026-10-12 in Asia/Tokyo = 2026-10-12T15:00:00.000Z
    expect(times.dueInstant).toBe("2026-10-12T15:00:00.000Z");
    expect(times.dueDateOnly).toBe(true);
  });

  it("historical no-tz relative phrase invents no formal date", async () => {
    const { manager, repo } = setupWithZone("Asia/Tokyo");
    const raw = await manager.capture("明天下午3点交报告");
    await repo.putRawCapture({ ...raw, captured_tz: null });
    const item = (await manager.processClearCapture(raw.id)) as Item;
    expect(item.due_at).toBeNull();
    expect(item.due_date).toBeNull();
    expect(item.title).toContain("明天");
    expect((await repo.getRawCapture(raw.id))?.raw_text).toBe(
      "明天下午3点交报告",
    );
  });

  it("purifies course-information content when context course prefixes the text", async () => {
    const { manager, repo } = setupWithZone("Asia/Shanghai");
    const course = await manager.createCourse("零基础日语听说");
    const raw = await manager.capture(
      "零基础日语听说，老师会点名回答",
      "COURSE_INFORMATION",
      course.id,
      "Asia/Shanghai",
    );
    const info = await manager.processClearCapture(raw.id);
    expect(info && "content" in info ? info.content : null).toBe(
      "老师会点名回答",
    );
    expect((await repo.getRawCapture(raw.id))?.raw_text).toBe(
      "零基础日语听说，老师会点名回答",
    );
  });
});
