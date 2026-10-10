import { expect, it } from "vitest";
import type { Locale } from "./i18n/locale.js";
import { formatOccurrence, formatStamp, timeSummaries } from "./TimeBlock.js";

const zh: Locale = "zh-CN";
const now2026 = new Date(2026, 9, 10); // local 2026-10-10
const nowYearEnd = new Date(2026, 11, 31); // local 2026-12-31

it("shows the year in TimeBlock stamps only outside the current local year", () => {
  expect(formatStamp("2026-10-21", zh, false, now2026)).toBe("10月21日");
  // Past years behave exactly like future years.
  expect(formatStamp("2025-03-05", zh, false, now2026)).toBe("2025年3月5日");
  expect(formatStamp("2027-01-01", zh, false, now2026)).toBe("2027年1月1日");
});

it("keeps real clock times on DATETIME stamps under the same rule", () => {
  expect(formatStamp("2026-10-21T15:00", zh, false, now2026)).toBe(
    "10月21日 15:00",
  );
  expect(formatStamp("2027-01-01T15:00", zh, false, now2026)).toBe(
    "2027年1月1日 15:00",
  );
  // 00:00 without forceTime is date-only; with forceTime the clock stays.
  expect(formatStamp("2026-10-21T00:00", zh, false, now2026)).toBe("10月21日");
  expect(formatStamp("2026-10-21T00:00", zh, true, now2026)).toBe(
    "10月21日 00:00",
  );
});

it("judges each end of a range by its own year (cross-year ranges)", () => {
  // Viewed on 2026-12-31 only the far end carries the year.
  expect(
    formatOccurrence("2026-12-30", "", "2027-01-02", "", zh, nowYearEnd),
  ).toContain("12月30日–2027年1月2日");
  // Viewed in 2027 the same stored range flips which end shows a year.
  expect(
    formatOccurrence(
      "2026-12-30",
      "",
      "2027-01-02",
      "",
      zh,
      new Date(2027, 0, 5),
    ),
  ).toContain("2026年12月30日–1月2日");
});

it("keeps DATETIME range clocks with per-end year decisions", () => {
  const text = formatOccurrence(
    "",
    "2026-10-21T09:00",
    "",
    "2027-01-02T11:30",
    zh,
    now2026,
  );
  expect(text).toContain("10月21日 09:00–2027年1月2日 11:30");
});

it("applies the same rule through timeSummaries", () => {
  const summaries = timeSummaries(
    {
      startAt: "",
      startDate: "",
      occurrenceStartAt: "",
      occurrenceStartDate: "2027-01-01",
      occurrenceEndAt: "",
      occurrenceEndDate: "",
      dueAt: "",
      dueDate: "2026-10-21",
    },
    zh,
    now2026,
  );
  expect(summaries[0]?.text).toContain("2027年1月1日");
  expect(summaries[1]?.text).toContain("10月21日");
  expect(summaries[1]?.text).not.toContain("2026年");
});
