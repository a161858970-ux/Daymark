import { expect, it } from "vitest";
import {
  anchorMatchesCalendar,
  anchorOf,
  applyWeekSelection,
  naturalWeeksBetween,
  projectedWeekNumber,
  projectedWeeks,
  shortRange,
  startOfWeek,
} from "./semesterWeeks.js";

it("treats a week as Monday to Sunday by default", () => {
  expect(startOfWeek("2026-09-09")).toBe("2026-09-07");
  expect(startOfWeek("2026-08-31")).toBe("2026-08-31");
  expect(shortRange({ start_date: "2026-09-07", end_date: "2026-09-13" })).toBe(
    "09.07 – 09.13",
  );
});

it("honours a configurable week start day", () => {
  // Sunday-start calendar: 09-06 is the Sunday of that week.
  expect(startOfWeek("2026-09-09", 0)).toBe("2026-09-06");
  expect(startOfWeek("2026-09-06", 0)).toBe("2026-09-06");
  // Saturday-start: 09-05 is itself a Saturday, and Monday 09-07 belongs
  // to the same week.
  expect(startOfWeek("2026-09-05", 6)).toBe("2026-09-05");
  expect(startOfWeek("2026-09-07", 6)).toBe("2026-09-05");
});

it("splits September into five Monday-based natural weeks", () => {
  const rows = naturalWeeksBetween("2026-09-01", "2026-09-30");
  expect(rows).toHaveLength(5);
  expect(rows[0]).toEqual({
    start_date: "2026-08-31",
    end_date: "2026-09-06",
  });
  expect(rows[4]).toEqual({
    start_date: "2026-09-28",
    end_date: "2026-10-04",
  });
});

it("splits September into Sunday-based weeks when configured", () => {
  const rows = naturalWeeksBetween("2026-09-01", "2026-09-30", 0);
  expect(rows[0]).toEqual({
    start_date: "2026-08-30",
    end_date: "2026-09-05",
  });
  expect(rows[4]).toEqual({
    start_date: "2026-09-27",
    end_date: "2026-10-03",
  });
});

it("projects later rows from the anchored first week", () => {
  const anchor = { week_number: 1, start_date: "2026-09-07" };
  expect(projectedWeekNumber(anchor, "2026-09-14")).toBe(2);
  expect(projectedWeekNumber(anchor, "2026-10-26")).toBe(8);
  // Only week-start rows project; a mid-week date is not a row.
  expect(projectedWeekNumber(anchor, "2026-09-08")).toBeNull();
  // Before the anchor there is no week 0 to project to.
  expect(projectedWeekNumber(anchor, "2026-08-31")).toBeNull();
});

it("projects on a Sunday calendar too", () => {
  const anchor = { week_number: 1, start_date: "2026-09-06" };
  expect(projectedWeekNumber(anchor, "2026-10-25", 0)).toBe(8);
  expect(projectedWeeks(anchor, "2026-10-25", 0)).toHaveLength(8);
});

it("keeps the stored first week and stops projecting across calendars", () => {
  // The user's stored date is never rewritten by a setting change.
  expect(
    anchorOf([
      { week_number: 3, start_date: "2026-09-21" },
      { week_number: 1, start_date: "2026-09-09" },
    ]),
  ).toEqual({ week_number: 1, start_date: "2026-09-09" });
  expect(anchorOf([])).toBeNull();

  // A Sunday-start first week cannot project onto a Monday calendar.
  const sundayAnchor = { week_number: 1, start_date: "2026-09-06" };
  expect(anchorMatchesCalendar(sundayAnchor, 1)).toBe(false);
  expect(projectedWeekNumber(sundayAnchor, "2026-09-07")).toBeNull();
});

it("fills every week up to the selected row", () => {
  const anchor = { week_number: 1, start_date: "2026-09-07" };
  const fill = projectedWeeks(anchor, "2026-10-26");
  expect(fill).toHaveLength(8);
  expect(fill![0]).toEqual({
    week_number: 1,
    start_date: "2026-09-07",
    end_date: "2026-09-13",
  });
  expect(fill![7]).toEqual({
    week_number: 8,
    start_date: "2026-10-26",
    end_date: "2026-11-01",
  });
  expect(fill!.map((week) => week.week_number)).toEqual([
    1, 2, 3, 4, 5, 6, 7, 8,
  ]);
});

it("replaces only the selected week numbers and keeps the group ordered", () => {
  const existing = [
    { week_number: 1, start_date: "2026-09-07", end_date: "2026-09-13" },
    { week_number: 2, start_date: "2026-09-14", end_date: "2026-09-20" },
  ];
  const next = applyWeekSelection(existing, [
    { week_number: 2, start_date: "2026-10-26", end_date: "2026-11-01" },
    { week_number: 3, start_date: "2026-09-21", end_date: "2026-09-27" },
  ]);
  expect(next.map((week) => week.week_number)).toEqual([1, 2, 3]);
  expect(next[1]).toEqual({
    week_number: 2,
    start_date: "2026-10-26",
    end_date: "2026-11-01",
  });
});
