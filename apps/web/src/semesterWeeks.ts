/**
 * Natural (Gregorian) weeks for semester week planning.
 *
 * Product decisions (2026-09-28):
 * - a week is a calendar week starting on a configurable weekday
 *   (default Monday; the product owner explicitly allows other start days),
 * - the user picks a week row instead of typing two dates, and once the
 *   first week is anchored every later row shows the week number it
 *   projects to — selecting it fills every week in between,
 * - the first week is never inferred: with no anchor nothing is projected.
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

/** First day of the week containing `value` (0 = Sunday … 6 = Saturday). */
export function startOfWeek(value: DateOnly, weekStart: number = 1): DateOnly {
  const ms = toMs(value);
  const day = new Date(ms).getUTCDay();
  const offset = (day - weekStart + 7) % 7;
  return toDateOnly(ms - offset * DAY_MS);
}

export function naturalWeek(value: DateOnly, weekStart: number = 1): WeekRange {
  const start = startOfWeek(value, weekStart);
  return { start_date: start, end_date: addDays(start, 6) };
}

/** Every week overlapping [from, to], oldest first. */
export function naturalWeeksBetween(
  from: DateOnly,
  to: DateOnly,
  weekStart: number = 1,
): WeekRange[] {
  const lastMs = toMs(to);
  const ranges: WeekRange[] = [];
  let startMs = toMs(startOfWeek(from, weekStart));
  while (startMs <= lastMs && ranges.length < 80) {
    const start = toDateOnly(startMs);
    ranges.push({ start_date: start, end_date: addDays(start, 6) });
    startMs += WEEK_MS;
  }
  return ranges;
}

/**
 * The earliest existing week anchors later rows. Its stored start date is
 * used verbatim — a projection must never rewrite a date the user chose.
 */
export function anchorOf(
  weeks: readonly Pick<WeekFields, "week_number" | "start_date">[],
): WeekAnchor | null {
  const first = [...weeks].sort((a, b) => a.week_number - b.week_number)[0];
  if (!first) return null;
  return { week_number: first.week_number, start_date: first.start_date };
}

/** True when the anchor still begins on the configured weekday. */
export function anchorMatchesCalendar(
  anchor: WeekAnchor,
  weekStart: number = 1,
): boolean {
  return startOfWeek(anchor.start_date, weekStart) === anchor.start_date;
}

/** Week number this row projects to, or null when it is not week-aligned. */
export function projectedWeekNumber(
  anchor: WeekAnchor,
  start: DateOnly,
  weekStart: number = 1,
): number | null {
  if (!anchorMatchesCalendar(anchor, weekStart)) return null;
  if (startOfWeek(start, weekStart) !== start) return null;
  const diff = toMs(start) - toMs(anchor.start_date);
  if (diff % WEEK_MS !== 0) return null;
  const number = anchor.week_number + diff / WEEK_MS;
  return number >= 1 ? number : null;
}

/** Every week from the anchor up to (and including) the selected row. */
export function projectedWeeks(
  anchor: WeekAnchor,
  start: DateOnly,
  weekStart: number = 1,
): WeekFields[] | null {
  const target = projectedWeekNumber(anchor, start, weekStart);
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
