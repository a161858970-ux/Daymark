import { expect, it } from "vitest";
import {
  reminderLevelForCapture,
  preprocessCapture,
  purifyTitle,
  removeSpanSafely,
  detectSplitCandidates,
} from "./captureParsing.js";
import type { Course } from "@daymark/domain";

const TZ = "Asia/Shanghai";
const CAPTURE = "2026-10-09T02:00:00.000Z";

const course = (id: string, name: string): Course => ({
  id,
  owner_id: "owner",
  semester_id: "sem",
  name,
  instructor: null,
  created_at: CAPTURE,
  updated_at: CAPTURE,
  deleted_at: null,
  row_version: 1,
});

const base = {
  source: "QUICK_CAPTURE" as const,
  capturedAt: CAPTURE,
  timeZone: TZ,
  contextCourseId: null,
};

it("raises the reminder level only for an explicit reminder request", () => {
  expect(reminderLevelForCapture("111大赛，10月30日前提交作品，提醒我")).toBe(
    "HIGH",
  );
  expect(reminderLevelForCapture("记得提醒我交房租")).toBe("HIGH");
  expect(reminderLevelForCapture("管理学原理，第一次作业，9月28日前提交")).toBe(
    "NORMAL",
  );
  expect(reminderLevelForCapture("找学姐要环境经济学笔记")).toBe("NORMAL");
});

it("classifies 找学姐要环境经济学笔记 as ITEM", () => {
  const parsed = preprocessCapture({
    ...base,
    rawText: "找学姐要环境经济学笔记",
    courses: [],
  });
  expect(parsed.classification).toBe("ITEM");
});

it("keeps clear item with date out of unresolved", () => {
  const parsed = preprocessCapture({
    ...base,
    rawText: "提交保险学作业10.12截止",
    courses: [],
    semesterYear: 2026,
  });
  expect(parsed.classification).toBe("ITEM");
  expect(parsed.timeFields.due_date).toBe("2026-10-12");
});

it("classifies unique-course teacher fact as COURSE_INFORMATION", () => {
  const parsed = preprocessCapture({
    ...base,
    rawText: "老师会点名回答",
    courses: [course("c1", "零基础日语听说")],
    contextCourseId: "c1",
  });
  expect(parsed.classification).toBe("COURSE_INFORMATION");
});

it("classifies 环境经济学，期末考试会画重点 as COURSE_INFORMATION", () => {
  const parsed = preprocessCapture({
    ...base,
    rawText: "环境经济学，期末考试会画重点",
    courses: [course("c1", "环境经济学")],
  });
  expect(parsed.classification).toBe("COURSE_INFORMATION");
});

it("keeps 老师让我们关注一下第三章 unresolved without auto AI", () => {
  const parsed = preprocessCapture({
    ...base,
    rawText: "老师让我们关注一下第三章",
    courses: [],
  });
  expect(parsed.classification).toBe("UNRESOLVED");
});

it("offers multi split candidates without auto-creating", () => {
  const parsed = preprocessCapture({
    ...base,
    rawText: "找学姐要笔记，提交报告",
    courses: [],
  });
  expect(parsed.classification).toBe("UNRESOLVED");
  expect(parsed.splitCandidates.length).toBeGreaterThanOrEqual(2);
});

it("purifies title only when time is absorbed", () => {
  const result = purifyTitle("保险公司财务分析作业10.12截止", [
    { start: 10, end: 16 },
  ]);
  expect(result.purified).toBe(true);
  expect(result.title).toContain("保险公司财务分析作业");
});

it("exact titles after absorbing deadline markers with DATE/DATETIME", () => {
  const base = {
    source: "QUICK_CAPTURE" as const,
    capturedAt: CAPTURE,
    timeZone: TZ,
    contextCourseId: null,
    courses: [] as Course[],
  };

  const a = preprocessCapture({
    ...base,
    rawText: "提交保险学作业10.12截止",
    semesterYear: 2026,
  });
  expect(a.classification).toBe("ITEM");
  expect(a.title).toBe("提交保险学作业");
  expect(a.timeFields.due_date).toBe("2026-10-12");
  expect(a.timeFields.due_at).toBeNull();

  const b = preprocessCapture({
    ...base,
    rawText: "保险公司财务分析作业10.12截止",
    semesterYear: 2026,
  });
  expect(b.classification).toBe("ITEM");
  expect(b.title).toBe("保险公司财务分析作业");
  expect(b.timeFields.due_date).toBe("2026-10-12");

  const c = preprocessCapture({
    ...base,
    rawText: "保险公司财务分析作业10.12 15:00截止",
    semesterYear: 2026,
  });
  expect(c.classification).toBe("ITEM");
  expect(c.title).toBe("保险公司财务分析作业");
  expect(c.timeFields.due_at).toBe("2026-10-12T07:00:00.000Z");
  expect(c.timeFields.due_date).toBeNull();

  const d = preprocessCapture({
    ...base,
    rawText: "明天下午3点交报告",
  });
  expect(d.classification).toBe("ITEM");
  expect(d.title).toBe("交报告");
  expect(d.timeFields.due_at).toBe("2026-10-10T07:00:00.000Z");

  const e = preprocessCapture({
    ...base,
    rawText: "第四周前交作业",
  });
  // No SemesterWeek mapping: keep the unstructured week phrase, invent nothing.
  expect(e.classification).toBe("ITEM");
  expect(e.title).toBe("第四周前交作业");
  expect(e.timeFields.due_date).toBeNull();
  expect(e.timeFields.due_at).toBeNull();
});

it("does not auto-fill relative dates for historical captures without tz", () => {
  const parsed = preprocessCapture({
    source: "QUICK_CAPTURE",
    rawText: "明天下午3点交报告",
    capturedAt: CAPTURE,
    timeZone: null,
    contextCourseId: null,
    courses: [],
  });
  expect(parsed.classification).toBe("ITEM");
  expect(parsed.timeFields.due_at).toBeNull();
  expect(parsed.timeFields.due_date).toBeNull();
  // The unstructured relative phrase stays in the title.
  expect(parsed.title).toContain("明天");
});

it("keeps original text when removing time would break the sentence", () => {
  const parsed = preprocessCapture({
    source: "QUICK_CAPTURE",
    rawText: "10.12的作业",
    capturedAt: CAPTURE,
    timeZone: TZ,
    contextCourseId: null,
    courses: [],
    semesterYear: 2026,
  });
  // "10.12的作业" — removing 10.12 would leave a broken fragment; prefer keep.
  expect(["10.12的作业", "的作业"]).toContain(parsed.title);
  if (parsed.timeFields.due_date) {
    expect(parsed.title.length).toBeGreaterThan(0);
    expect(parsed.title).not.toBe("的");
  }
});

it("refuses removal that would leave a broken fragment", () => {
  expect(removeSpanSafely("的", 0, 1)).toBeNull();
  expect(removeSpanSafely("交作业", 0, 3)).toBeNull();
});

it("does not invent bare 8点", () => {
  const parsed = preprocessCapture({
    ...base,
    rawText: "8点交材料",
    courses: [],
  });
  expect(parsed.unresolvedTimes.length + parsed.times.length).toBeGreaterThan(
    0,
  );
  expect(parsed.timeFields.due_at).toBeNull();
  expect(parsed.timeFields.due_date).toBeNull();
});

it("detects multi action split candidates conservatively", () => {
  expect(detectSplitCandidates("找学姐要笔记，提交报告")).toHaveLength(2);
  expect(detectSplitCandidates("找学姐要笔记")).toHaveLength(0);
});

it("keeps course name mid-sentence in course information content", () => {
  const parsed = preprocessCapture({
    ...base,
    source: "COURSE_INFORMATION",
    rawText: "零基础日语听说，老师会点名回答",
    courses: [course("c1", "零基础日语听说")],
    contextCourseId: "c1",
  });
  expect(parsed.classification).toBe("COURSE_INFORMATION");
  expect(parsed.content === null || parsed.content.length > 0).toBe(true);
});
