import type { Item, Semester, SemesterWeek } from "./entities.js";
import { projectItemToCalendar, semesterForMonth } from "./projections.js";

export interface CalendarDay {
  date: string;
  in_visible_month: boolean;
}

export interface CalendarSegment {
  item_id: string;
  kind: "POINT" | "RANGE";
  start_column: number;
  end_column: number;
  begins_here: boolean;
  ends_here: boolean;
}

export interface CalendarWeekRow {
  start_date: string;
  end_date: string;
  days: CalendarDay[];
  semester_week: number | null;
  segments: CalendarSegment[];
}

export interface CalendarMonth {
  year: number;
  month: number;
  semester: Semester | null;
  weeks: CalendarWeekRow[];
}

export function addCalendarDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function localDateOfInstant(instant: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(instant));
  const field = (name: string) =>
    parts.find((part) => part.type === name)!.value;
  return `${field("year")}-${field("month")}-${field("day")}`;
}

/** Month rows contain visual segments of one canonical Item, never copied Items. */
export function buildCalendarMonth(
  year: number,
  month: number,
  items: readonly Item[],
  semesters: readonly Semester[],
  semesterWeeks: readonly SemesterWeek[],
  timeZone: string,
): CalendarMonth {
  if (
    !Number.isSafeInteger(year) ||
    !Number.isSafeInteger(month) ||
    month < 1 ||
    month > 12
  )
    throw new Error("Invalid calendar month");
  const first = `${year}-${String(month).padStart(2, "0")}-01`;
  const last = `${year}-${String(month).padStart(2, "0")}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, "0")}`;
  const weekday = new Date(`${first}T00:00:00Z`).getUTCDay();
  const gridStart = addCalendarDays(first, -(weekday === 0 ? 6 : weekday - 1));
  const semester = semesterForMonth(year, month, semesters);
  const projections = items.flatMap((item) => {
    const projection = projectItemToCalendar(item);
    if (!projection) return [];
    return [
      {
        item_id: item.id,
        kind: projection.kind,
        start_date: localDateOfInstant(projection.start, timeZone),
        end_date: localDateOfInstant(projection.end, timeZone),
      },
    ];
  });
  const weeks: CalendarWeekRow[] = [];
  for (
    let start = gridStart;
    start <= last;
    start = addCalendarDays(start, 7)
  ) {
    const end = addCalendarDays(start, 6);
    const days = Array.from({ length: 7 }, (_, index) => {
      const date = addCalendarDays(start, index);
      return { date, in_visible_month: date.slice(0, 7) === first.slice(0, 7) };
    });
    const academicWeek = semesterWeeks.find(
      (week) =>
        week.semester_id === semester?.id &&
        week.start_date <= end &&
        week.end_date >= start,
    );
    const segments = projections.flatMap((projection): CalendarSegment[] => {
      if (projection.end_date < start || projection.start_date > end) return [];
      const clippedStart =
        projection.start_date < start ? start : projection.start_date;
      const clippedEnd = projection.end_date > end ? end : projection.end_date;
      return [
        {
          item_id: projection.item_id,
          kind: projection.kind,
          start_column: days.findIndex((day) => day.date === clippedStart) + 1,
          end_column: days.findIndex((day) => day.date === clippedEnd) + 1,
          begins_here: projection.start_date >= start,
          ends_here: projection.end_date <= end,
        },
      ];
    });
    weeks.push({
      start_date: start,
      end_date: end,
      days,
      semester_week: academicWeek?.week_number ?? null,
      segments,
    });
  }
  return { year, month, semester, weeks };
}

export function calendarItemsForDay(
  date: string,
  items: readonly Item[],
  timeZone: string,
): Item[] {
  return items.filter((item) => {
    const projection = projectItemToCalendar(item);
    if (!projection) return false;
    return (
      localDateOfInstant(projection.start, timeZone) <= date &&
      localDateOfInstant(projection.end, timeZone) >= date
    );
  });
}
