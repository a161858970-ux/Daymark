import { expect, it } from "vitest";
import {
  anchorOf,
  applyWeekSelection,
  mondayOf,
  naturalWeeksBetween,
  projectedWeekNumber,
  projectedWeeks,
  shortRange,
} from "./semesterWeeks.js";

it("treats a week as Monday to Sunday", () => {
  expect(mondayOf("2026-09-09")).toBe("2026-09-07");
  expect(mondayOf("2026-08-31")).toBe("2026-08-31");
  expect(shortRange({ start_date: "2026-09-07", end_date: "2026-09-13" })).toBe(
    "09.07 – 09.13",
  );
});

it("splits September into the five natural weeks the product describes", () => {
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

it("projects later rows from the anchored first week", () => {
  const anchor = { week_number: 1, start_date: "2026-09-07" };
  expect(projectedWeekNumber(anchor, "2026-09-14")).toBe(2);
  expect(projectedWeekNumber(anchor, "2026-10-26")).toBe(8);
  // Any day inside the anchor week still belongs to week 1 (rows are
  // Mondays, but a stray date must not fall out of the calendar).
  expect(projectedWeekNumber(anchor, "2026-09-08")).toBe(1);
  // Before the anchor there is no week 0 to project to.
  expect(projectedWeekNumber(anchor, "2026-08-31")).toBeNull();
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

it("takes the anchor from the earliest existing week and normalizes it", () => {
  expect(
    anchorOf([
      { week_number: 3, start_date: "2026-09-21" },
      { week_number: 1, start_date: "2026-09-09" },
    ]),
  ).toEqual({ week_number: 1, start_date: "2026-09-07" });
  expect(anchorOf([])).toBeNull();
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
