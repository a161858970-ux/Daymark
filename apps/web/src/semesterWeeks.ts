/**
 * Natural (Gregorian) weeks for semester week planning.
 *
 * Product decision 2026-09-28: a week is always a Monday-to-Sunday calendar
 * week, the user picks a week row instead of typing two dates, and once a
 * first week is anchored every later row shows the week number it projects
 * to — selecting it fills every week in between.
 *
 * All arithmetic is UTC-based on `YYYY-MM-DD` so no local timezone can shift
 * a date by a day.
 */

export type DateOnly = string;

export interface WeekFields {
  week_number: number;
  start_date: DateOnly;
  end_date: DateOnly;
}

export interface WeekRange {
  start_date: DateOnly;
  end_date: DateOnly;
}

export interface WeekAnchor {
  week_number: number;
  start_date: DateOnly;
}

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

function toMs(value: DateOnly): number {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) throw new Error(`Invalid date: ${value}`);
  return Date.UTC(year, month - 1, day);
}

function toDateOnly(ms: number): DateOnly {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function addDays(value: DateOnly, days: number): DateOnly {
  return toDateOnly(toMs(value) + days * DAY_MS);
}

/** Monday of the ISO week containing `value`. */
export function mondayOf(value: DateOnly): DateOnly {
  const ms = toMs(value);
  const offset = (new Date(ms).getUTCDay() + 6) % 7; // 0 = Monday
  return toDateOnly(ms - offset * DAY_MS);
}

export function naturalWeek(value: DateOnly): WeekRange {
  const start = mondayOf(value);
  return { start_date: start, end_date: addDays(start, 6) };
}

/** Every Monday-to-Sunday week overlapping [from, to], oldest first. */
export function naturalWeeksBetween(from: DateOnly, to: DateOnly): WeekRange[] {
  const lastMs = toMs(to);
  const ranges: WeekRange[] = [];
  let startMs = toMs(mondayOf(from));
  while (startMs <= lastMs && ranges.length < 60) {
    const start = toDateOnly(startMs);
    ranges.push({ start_date: start, end_date: addDays(start, 6) });
    startMs += WEEK_MS;
  }
  return ranges;
}

/** The earliest existing week is the anchor later rows project from. */
export function anchorOf(
  weeks: readonly Pick<WeekFields, "week_number" | "start_date">[],
): WeekAnchor | null {
  const first = [...weeks].sort((a, b) => a.week_number - b.week_number)[0];
  if (!first) return null;
  return {
    week_number: first.week_number,
    start_date: mondayOf(first.start_date),
  };
}

/** Week number this natural week projects to, or null when not week-aligned. */
export function projectedWeekNumber(
  anchor: WeekAnchor,
  start: DateOnly,
): number | null {
  const diff = toMs(mondayOf(start)) - toMs(anchor.start_date);
  if (diff % WEEK_MS !== 0) return null;
  const number = anchor.week_number + diff / WEEK_MS;
  return number >= 1 ? number : null;
}

/** Every week from the anchor up to (and including) the selected row. */
export function projectedWeeks(
  anchor: WeekAnchor,
  start: DateOnly,
): WeekFields[] | null {
  const target = projectedWeekNumber(anchor, start);
  if (target === null) return null;
  const weeks: WeekFields[] = [];
  for (let number = anchor.week_number; number <= target; number += 1) {
    const offset = number - anchor.week_number;
    const startDate = addDays(anchor.start_date, offset * 7);
    weeks.push({
      week_number: number,
      start_date: startDate,
      end_date: addDays(startDate, 6),
    });
  }
  return weeks;
}

/**
 * Whole-group replacement: selected weeks replace existing weeks with the
 * same number, every other week survives, and the result stays ordered.
 */
export function applyWeekSelection(
  existing: readonly WeekFields[],
  selection: readonly WeekFields[],
): WeekFields[] {
  const numbers = new Set(selection.map((week) => week.week_number));
  const kept = existing.filter((week) => !numbers.has(week.week_number));
  return [...kept, ...selection].sort((a, b) => a.week_number - b.week_number);
}

/** `09.07 – 09.13` for a row label. */
export function shortRange(range: WeekRange): string {
  const monthDay = (value: DateOnly) => value.slice(5).replace("-", ".");
  return `${monthDay(range.start_date)} – ${monthDay(range.end_date)}`;
}

export function monthKey(range: WeekRange): string {
  return range.start_date.slice(0, 7);
}

export function monthLabel(key: string): string {
  const [year, month] = key.split("-");
  return `${year} 年 ${Number(month)} 月`;
}
