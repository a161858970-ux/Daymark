import { expect, it } from "vitest";
import {
  parseTimes,
  timesToItemFields,
  completeYearlessMonthDay,
  localDateOfInstant,
  endOfLocalDayInstant,
  localDay0900Instant,
  addDays,
} from "./timeParsing.js";

const TZ = "Asia/Shanghai";
// Fixed capture: 2026-10-09 local morning
const CAPTURE = "2026-10-09T02:00:00.000Z"; // 10:00 Asia/Shanghai

it("parses 明天下午3点 as DATETIME next local day 15:00", () => {
  const result = parseTimes({
    text: "明天下午3点交报告",
    capturedAt: CAPTURE,
    timeZone: TZ,
  });
  expect(result.resolved).toHaveLength(1);
  const time = result.resolved[0]!;
  expect(time.precision).toBe("DATETIME");
  expect(time.semantic).toBe("due");
  // 2026-10-10 15:00 +08:00 = 07:00Z
  expect(time.instant).toBe("2026-10-10T07:00:00.000Z");
});

it("completes year-less 10.12 from semester year", () => {
  const result = parseTimes({
    text: "提交保险学作业10.12截止",
    capturedAt: CAPTURE,
    timeZone: TZ,
    semesterYear: 2026,
    semester: { start_date: "2026-09-01", end_date: "2027-01-15" },
  });
  const due = result.resolved.find((t) => t.semantic === "due");
  expect(due?.precision).toBe("DATE");
  expect(due?.date).toBe("2026-10-12");
});

it("rolls year-less 10.12 to next year when already past and no semester", () => {
  const result = parseTimes({
    text: "10.12截止",
    capturedAt: "2026-10-13T02:00:00.000Z",
    timeZone: TZ,
  });
  const due = result.resolved.find((t) => t.semantic === "due");
  expect(due?.date).toBe("2027-10-12");
});

it("treats X前 as previous local day DATE due", () => {
  const result = parseTimes({
    text: "10月12日前提交保险公司财务分析作业",
    capturedAt: CAPTURE,
    timeZone: TZ,
  });
  const due = result.resolved.find((t) => t.semantic === "due");
  expect(due?.precision).toBe("DATE");
  expect(due?.date).toBe("2026-10-11");
  expect(due?.beforeTarget).toBe(true);
});

it("parses 10.12 15:00截止 as DATETIME", () => {
  const result = parseTimes({
    text: "保险公司财务分析作业10.12 15:00截止",
    capturedAt: CAPTURE,
    timeZone: TZ,
    semesterYear: 2026,
  });
  const due = result.resolved.find((t) => t.semantic === "due");
  expect(due?.precision).toBe("DATETIME");
  expect(due?.instant).toBe("2026-10-12T07:00:00.000Z");
});

it("maps 周二前 to previous day of that Tuesday", () => {
  // 2026-10-09 is Friday. Next Tuesday = 2026-10-13. 周二前 → 2026-10-12.
  const result = parseTimes({
    text: "周二前交作业",
    capturedAt: CAPTURE,
    timeZone: TZ,
  });
  const due = result.resolved.find((t) => t.semantic === "due");
  expect(due?.precision).toBe("DATE");
  expect(due?.date).toBe("2026-10-12");
});

it("parses 下周三课堂展示 as DATE occurrence", () => {
  const result = parseTimes({
    text: "下周三课堂展示",
    capturedAt: CAPTURE,
    timeZone: TZ,
  });
  const occ = result.resolved.find((t) => t.semantic === "occurrence");
  expect(occ?.precision).toBe("DATE");
  // Capture local 2026-10-09 Friday → next week Wed = 2026-10-14
  expect(occ?.date).toBe("2026-10-14");
});

it("uses SemesterWeek for 第4周前 without fabricating bare 第4周", () => {
  const weeks = [
    { week_number: 4, start_date: "2026-10-12", end_date: "2026-10-18" },
  ];
  const before = parseTimes({
    text: "第4周前交作业",
    capturedAt: CAPTURE,
    timeZone: TZ,
    semesterWeeks: weeks,
  });
  const due = before.resolved.find((t) => t.semantic === "due");
  expect(due?.date).toBe("2026-10-11");

  const bare = parseTimes({
    text: "第4周课堂展示",
    capturedAt: CAPTURE,
    timeZone: TZ,
    semesterWeeks: weeks,
  });
  expect(bare.resolved).toHaveLength(0);
  expect(bare.unresolved.some((u) => u.rawPhrase.includes("第4周"))).toBe(true);
});

it("keeps bare 8点 unresolved and does not invent a clock", () => {
  const result = parseTimes({
    text: "8点交材料",
    capturedAt: CAPTURE,
    timeZone: TZ,
  });
  expect(result.resolved.every((t) => t.precision !== "DATETIME")).toBe(true);
  expect(result.unresolved.length).toBeGreaterThan(0);
});

it("is stable when reprocessed after the calendar day advances", () => {
  const text = "明天下午3点交报告";
  const first = parseTimes({ text, capturedAt: CAPTURE, timeZone: TZ });
  const later = parseTimes({
    text,
    capturedAt: "2026-10-10T16:00:00.000Z",
    timeZone: TZ,
  });
  // Same capture instant semantics: both use their own capture day correctly.
  expect(first.resolved[0]!.instant).toBe("2026-10-10T07:00:00.000Z");
  // Later capture (local 2026-10-11) → 明天 = 10-12
  expect(later.resolved[0]!.instant).toBe("2026-10-12T07:00:00.000Z");
});

it("maps times into mutually exclusive item fields", () => {
  const fields = timesToItemFields([
    {
      semantic: "due",
      precision: "DATE",
      date: "2026-10-12",
      instant: null,
      rawPhrase: "10.12",
      span: { start: 0, end: 4 },
      timeZone: TZ,
      evidence: "test",
      beforeTarget: false,
    },
    {
      semantic: "occurrence",
      precision: "DATETIME",
      date: null,
      instant: "2026-10-14T07:00:00.000Z",
      rawPhrase: "下周三15:00",
      span: { start: 5, end: 12 },
      timeZone: TZ,
      evidence: "test",
      beforeTarget: false,
    },
  ]);
  expect(fields.due_date).toBe("2026-10-12");
  expect(fields.due_at).toBeNull();
  expect(fields.occurrence_start_at).toBe("2026-10-14T07:00:00.000Z");
  expect(fields.occurrence_start_date).toBeNull();
});

it("computes DATE due end-of-day and occurrence 09:00 anchors with IANA rules", () => {
  const end = endOfLocalDayInstant("2026-10-12", TZ);
  // Next local midnight 2026-10-13 00:00 +08 = 2026-10-12T16:00:00.000Z
  expect(end).toBe("2026-10-12T16:00:00.000Z");
  const anchor = localDay0900Instant("2026-10-14", TZ);
  expect(anchor).toBe("2026-10-14T01:00:00.000Z");
});

it("handles leap day and invalid dates", () => {
  const leap = parseTimes({
    text: "2028年2月29日截止",
    capturedAt: CAPTURE,
    timeZone: TZ,
  });
  expect(leap.resolved[0]?.date).toBe("2028-02-29");
  const invalid = parseTimes({
    text: "2026年2月30日截止",
    capturedAt: CAPTURE,
    timeZone: TZ,
  });
  expect(invalid.resolved).toHaveLength(0);
});

it("derives capture local date from instant + IANA zone", () => {
  expect(localDateOfInstant("2026-10-09T16:30:00.000Z", TZ)).toBe("2026-10-10");
  expect(localDateOfInstant("2026-10-09T15:59:00.000Z", TZ)).toBe("2026-10-09");
});

it("year-less helper prefers semester year", () => {
  const completed = completeYearlessMonthDay(
    10,
    12,
    {
      text: "",
      capturedAt: CAPTURE,
      timeZone: TZ,
      semesterYear: 2026,
      semester: { start_date: "2026-09-01", end_date: "2027-01-15" },
    },
    "2026-10-09",
  );
  expect(completed?.date).toBe("2026-10-12");
});

it("addDays crosses month boundaries", () => {
  expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
  expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
});

it("does not invent relative dates for historical captures without captured_tz", () => {
  const relative = parseTimes({
    text: "明天下午3点交报告",
    capturedAt: CAPTURE,
    timeZone: null,
  });
  expect(relative.resolved).toHaveLength(0);
  expect(relative.unresolved.some((u) => u.rawPhrase.includes("明天"))).toBe(
    true,
  );

  const weekday = parseTimes({
    text: "下周三课堂展示",
    capturedAt: CAPTURE,
    timeZone: null,
  });
  expect(weekday.resolved).toHaveLength(0);
  expect(weekday.unresolved.length).toBeGreaterThan(0);

  const yearless = parseTimes({
    text: "10.12截止",
    capturedAt: CAPTURE,
    timeZone: null,
  });
  expect(yearless.resolved).toHaveLength(0);
});

it("still parses absolute dated expressions without captured_tz", () => {
  const absolute = parseTimes({
    text: "2026年10月12日截止",
    capturedAt: CAPTURE,
    timeZone: null,
  });
  expect(absolute.resolved).toHaveLength(1);
  expect(absolute.resolved[0]!.precision).toBe("DATE");
  expect(absolute.resolved[0]!.date).toBe("2026-10-12");

  // Semester year can complete year-less dates without capture tz.
  const withSemester = parseTimes({
    text: "10.12截止",
    capturedAt: CAPTURE,
    timeZone: null,
    semesterYear: 2026,
    semester: { start_date: "2026-09-01", end_date: "2027-01-15" },
  });
  expect(withSemester.resolved[0]?.date).toBe("2026-10-12");
});
