import { expect, it } from "vitest";
import type { Item, Semester, SemesterWeek } from "./entities.js";
import { buildCalendarMonth, calendarItemsForDay } from "./calendar.js";

const item = (id: string, patch: Partial<Item> = {}): Item => ({
  id,
  owner_id: "owner",
  course_id: null,
  title: id,
  detail: null,
  status: "INCOMPLETE",
  start_at: null,
  start_date: null,
  occurrence_start_at: null,
  occurrence_start_date: null,
  occurrence_end_at: null,
  occurrence_end_date: null,
  due_at: null,
  due_date: null,
  time_zone: "UTC",
  reminder_level: "NORMAL",
  completed_at: null,
  raw_capture_id: null,
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
  deleted_at: null,
  row_version: 1,
  ...patch,
});

it("derives month semester and week labels without turning CourseSchedule into events", () => {
  const semester: Semester = {
    id: "autumn",
    owner_id: "owner",
    name: "2026 秋季学期",
    start_date: "2026-09-01",
    end_date: "2026-12-31",
    created_at: "",
    updated_at: "",
    deleted_at: null,
    row_version: 1,
  };
  const weeks: SemesterWeek[] = [
    {
      id: "week-one",
      owner_id: "owner",
      semester_id: semester.id,
      week_number: 1,
      start_date: "2026-09-01",
      end_date: "2026-09-06",
    },
  ];
  const september = buildCalendarMonth(
    2026,
    9,
    [],
    [semester],
    weeks,
    "Asia/Hong_Kong",
  );
  expect(september.semester?.name).toBe("2026 秋季学期");
  expect(
    september.weeks.find((week) =>
      week.days.some((day) => day.date === "2026-09-01"),
    )?.semester_week,
  ).toBe(1);
  expect(
    september.weeks.find((week) =>
      week.days.some((day) => day.date === "2026-09-08"),
    )?.semester_week,
  ).toBeNull();
  expect(september.weeks.every((week) => week.segments.length === 0)).toBe(
    true,
  );
  const february = buildCalendarMonth(
    2027,
    2,
    [],
    [semester],
    weeks,
    "Asia/Hong_Kong",
  );
  expect(february.semester).toBeNull();

  const crossing = buildCalendarMonth(
    2027,
    1,
    [],
    [
      {
        ...semester,
        id: "winter",
        name: "冬季学期",
        start_date: "2026-10-01",
        end_date: "2027-01-03",
      },
    ],
    [],
    "Asia/Hong_Kong",
  );
  expect(crossing.semester?.name).toBe("冬季学期");
});

it("projects occurrence and start/due ranges as segments of the same Item identity", () => {
  const occurrence = item("occurrence", {
    occurrence_start_at: "2026-09-25T16:00:00Z",
    occurrence_end_at: "2026-10-02T16:00:00Z",
    start_at: "2026-09-01T00:00:00Z",
    due_at: "2026-10-31T00:00:00Z",
  });
  const startDue = item("start-due", {
    start_at: "2026-09-23T00:00:00Z",
    due_at: "2026-09-29T00:00:00Z",
    status: "COMPLETE",
    completed_at: "2026-09-30T00:00:00Z",
  });
  const noTime = item("no-time");
  const month = buildCalendarMonth(
    2026,
    9,
    [occurrence, startDue, noTime],
    [],
    [],
    "Asia/Hong_Kong",
  );
  const occurrenceSegments = month.weeks.flatMap((week) =>
    week.segments.filter((segment) => segment.item_id === occurrence.id),
  );
  expect(occurrenceSegments).toHaveLength(2);
  expect(occurrenceSegments.every((segment) => segment.kind === "RANGE")).toBe(
    true,
  );
  expect(
    month.weeks.flatMap((week) =>
      week.segments.map((segment) => segment.item_id),
    ),
  ).not.toContain(noTime.id);
  expect(
    calendarItemsForDay(
      "2026-09-27",
      [occurrence, startDue, noTime],
      "Asia/Hong_Kong",
    ).map((value) => value.id),
  ).toEqual([startDue.id, occurrence.id]);
  expect(
    calendarItemsForDay("2026-09-15", [occurrence], "Asia/Hong_Kong"),
  ).toEqual([]);
});

it("orders the single-day projection by the item's actual time", () => {
  const later = item("later", { due_at: "2026-09-24T12:00:00Z" });
  const spanning = item("spanning", {
    occurrence_start_at: "2026-09-23T16:00:00Z",
    occurrence_end_at: "2026-09-25T10:00:00Z",
  });
  const earlier = item("earlier", { start_at: "2026-09-24T01:00:00Z" });
  expect(
    calendarItemsForDay(
      "2026-09-24",
      [later, earlier, spanning],
      "Asia/Hong_Kong",
    ).map((value) => value.id),
  ).toEqual(["spanning", "earlier", "later"]);
});

/** Collect every day column that carries a segment for `itemId`. */
function daysWithSegment(
  month: ReturnType<typeof buildCalendarMonth>,
  itemId: string,
): string[] {
  const days: string[] = [];
  for (const week of month.weeks) {
    for (const segment of week.segments) {
      if (segment.item_id !== itemId) continue;
      for (let col = segment.start_column; col <= segment.end_column; col++) {
        const day = week.days[col - 1];
        if (day) days.push(day.date);
      }
    }
  }
  return [...new Set(days)].sort();
}

it("keeps a single DATE occurrence on exactly one calendar day in every timezone", () => {
  const single = item("date-single", {
    occurrence_start_date: "2026-10-12",
  });
  for (const timeZone of [
    "Asia/Shanghai",
    "America/Los_Angeles",
    "UTC",
  ] as const) {
    const month = buildCalendarMonth(2026, 10, [single], [], [], timeZone);
    expect(daysWithSegment(month, single.id), timeZone).toEqual(["2026-10-12"]);
    expect(
      calendarItemsForDay("2026-10-11", [single], timeZone),
      `${timeZone} day-before`,
    ).toEqual([]);
    expect(
      calendarItemsForDay("2026-10-12", [single], timeZone),
      `${timeZone} day-of`,
    ).toEqual([single]);
    expect(
      calendarItemsForDay("2026-10-13", [single], timeZone),
      `${timeZone} day-after`,
    ).toEqual([]);
  }
});

it("covers exactly the inclusive days of a DATE occurrence range", () => {
  const range = item("date-range", {
    occurrence_start_date: "2026-10-12",
    occurrence_end_date: "2026-10-14",
  });
  for (const timeZone of [
    "Asia/Shanghai",
    "America/Los_Angeles",
    "UTC",
  ] as const) {
    const month = buildCalendarMonth(2026, 10, [range], [], [], timeZone);
    expect(daysWithSegment(month, range.id), timeZone).toEqual([
      "2026-10-12",
      "2026-10-13",
      "2026-10-14",
    ]);
    expect(calendarItemsForDay("2026-10-11", [range], timeZone)).toEqual([]);
    expect(calendarItemsForDay("2026-10-15", [range], timeZone)).toEqual([]);
    expect(
      calendarItemsForDay("2026-10-12", [range], timeZone).map((v) => v.id),
    ).toEqual([range.id]);
    expect(
      calendarItemsForDay("2026-10-14", [range], timeZone).map((v) => v.id),
    ).toEqual([range.id]);
  }
});

it("splits a DATE range across week rows without adding extra days", () => {
  // 2026-10-12 Mon … 2026-10-18 Sun is one natural week; 12–18 spans two weeks.
  const range = item("cross-week", {
    occurrence_start_date: "2026-10-12",
    occurrence_end_date: "2026-10-18",
  });
  const month = buildCalendarMonth(2026, 10, [range], [], [], "UTC");
  expect(daysWithSegment(month, range.id)).toEqual([
    "2026-10-12",
    "2026-10-13",
    "2026-10-14",
    "2026-10-15",
    "2026-10-16",
    "2026-10-17",
    "2026-10-18",
  ]);
  const segments = month.weeks.flatMap((week) =>
    week.segments.filter((s) => s.item_id === range.id),
  );
  expect(segments.length).toBeGreaterThanOrEqual(1);
  expect(segments.every((s) => s.kind === "RANGE")).toBe(true);
});

it("does not shift DATE due/start points across timezones", () => {
  const due = item("date-due", { due_date: "2026-10-12" });
  for (const timeZone of [
    "America/Los_Angeles",
    "UTC",
    "Asia/Tokyo",
  ] as const) {
    expect(
      calendarItemsForDay("2026-10-12", [due], timeZone).map((v) => v.id),
      timeZone,
    ).toEqual([due.id]);
    expect(
      calendarItemsForDay("2026-10-11", [due], timeZone),
      `${timeZone} before`,
    ).toEqual([]);
    expect(
      calendarItemsForDay("2026-10-13", [due], timeZone),
      `${timeZone} after`,
    ).toEqual([]);
  }
});
