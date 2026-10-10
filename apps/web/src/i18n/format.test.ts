import { expect, it } from "vitest";
import {
  formatItemDateOnly,
  formatItemDateTime,
  formatDateOnly,
} from "./format.js";

// Fixed "now" values constructed in local time so every expectation holds in
// any test-machine timezone; DATETIME values are local instants for the same
// reason (display year must be the local display year, never the UTC year).
const now2026 = new Date(2026, 9, 10); // local 2026-10-10
const nowYearEnd = new Date(2026, 11, 31); // local 2026-12-31
const nowNewYear = new Date(2027, 0, 1); // local 2027-01-01

it("shows the year only when the item's displayed year differs (frozen rule)", () => {
  // Past dates in the current year hide the year exactly like future dates.
  expect(formatItemDateOnly("2026-10-21", "zh-CN", now2026)).toBe("10月21日");
  expect(formatItemDateOnly("2026-03-05", "zh-CN", now2026)).toBe("3月5日");
  expect(formatItemDateOnly("2027-01-01", "zh-CN", now2026)).toBe(
    "2027年1月1日",
  );
  expect(formatItemDateOnly("2025-12-31", "zh-CN", now2026)).toBe(
    "2025年12月31日",
  );
});

it("keeps clock times and applies the same year rule to DATETIME", () => {
  const currentYear = new Date(2026, 9, 21, 15, 0); // local 2026-10-21 15:00
  expect(formatItemDateTime(currentYear, "zh-CN", now2026)).toBe(
    "10月21日 15:00",
  );
  const otherYear = new Date(2027, 0, 1, 15, 0); // local 2027-01-01 15:00
  expect(formatItemDateTime(otherYear, "zh-CN", now2026)).toBe(
    "2027年1月1日 15:00",
  );
});

it("rolls the displayed year with the current natural year across New Year", () => {
  // Scenario 1: today is 2026-12-31.
  expect(formatItemDateOnly("2026-12-31", "zh-CN", nowYearEnd)).toBe(
    "12月31日",
  );
  expect(formatItemDateOnly("2027-01-01", "zh-CN", nowYearEnd)).toBe(
    "2027年1月1日",
  );
  expect(
    formatItemDateTime(new Date(2027, 0, 1, 15, 0), "zh-CN", nowYearEnd),
  ).toBe("2027年1月1日 15:00");
  // Scenario 2: today is 2027-01-01 — the very same stored items re-render.
  expect(formatItemDateOnly("2026-12-31", "zh-CN", nowNewYear)).toBe(
    "2026年12月31日",
  );
  expect(formatItemDateOnly("2027-01-01", "zh-CN", nowNewYear)).toBe("1月1日");
});

it("renders natural English under the same rule", () => {
  expect(formatItemDateOnly("2026-10-21", "en-US", now2026)).toBe("October 21");
  expect(formatItemDateOnly("2027-01-01", "en-US", now2026)).toBe(
    "January 1, 2027",
  );
  const withClock = new Date(2027, 0, 1, 15, 0);
  const english = formatItemDateTime(withClock, "en-US", now2026);
  expect(english).toContain("2027");
  expect(english).toContain("Jan");
});

it("keeps the full-date detail formatter untouched", () => {
  // Detail panels keep complete dates; the compact rule only applies to the
  // shared list labels.
  expect(formatDateOnly("2026-10-21", "zh-CN")).toBe("2026年10月21日");
});
