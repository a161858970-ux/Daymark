import type { Course, Item, Semester, SemesterWeek } from "./entities.js";

export function hasItemTime(item: Item): boolean {
  return Boolean(
    item.start_at ||
    item.start_date ||
    item.occurrence_start_at ||
    item.occurrence_start_date ||
    item.occurrence_end_at ||
    item.occurrence_end_date ||
    item.due_at ||
    item.due_date,
  );
}

/**
 * Canonical query-time key from 15_DATABASE_SCHEMA §9.3.
 * DATE values sort as their local calendar day start for ordering only.
 */
export function overviewSortAt(item: Item, now: string): string | null {
  const times = [
    item.due_at,
    item.occurrence_start_at,
    item.start_at,
    item.occurrence_end_at,
    item.due_date ? `${item.due_date}T00:00:00.000Z` : null,
    item.occurrence_start_date
      ? `${item.occurrence_start_date}T00:00:00.000Z`
      : null,
    item.occurrence_end_date
      ? `${item.occurrence_end_date}T00:00:00.000Z`
      : null,
    item.start_date ? `${item.start_date}T00:00:00.000Z` : null,
  ]
    .filter((value): value is string => value !== null)
    .sort();
  if (times.length === 0) return null;
  return times.find((value) => value >= now) ?? times[times.length - 1] ?? null;
}

export function sortOverview(items: readonly Item[], now: string): Item[] {
  return items
    .filter((item) => item.deleted_at === null)
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === "INCOMPLETE" ? -1 : 1;
      if (a.status === "COMPLETE")
        return (
          b.completed_at?.localeCompare(a.completed_at ?? "") ||
          b.created_at.localeCompare(a.created_at) ||
          b.id.localeCompare(a.id)
        );
      const aAt = overviewSortAt(a, now);
      const bAt = overviewSortAt(b, now);
      if (aAt === null && bAt !== null) return -1;
      if (aAt !== null && bAt === null) return 1;
      if (aAt === null && bAt === null)
        return (
          b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id)
        );
      return (
        (aAt ?? "").localeCompare(bAt ?? "") ||
        b.created_at.localeCompare(a.created_at) ||
        b.id.localeCompare(a.id)
      );
    });
}

/** An Item has one identity even when its visual range covers several dates. */
export interface CalendarProjection {
  item_id: string;
  start: string;
  end: string;
  kind: "RANGE" | "POINT";
  /** DATE / all-day — render as full-day, never a fake clock. */
  all_day: boolean;
}

function dateAsUtcMidnight(date: string): string {
  return `${date}T00:00:00.000Z`;
}

function nextDateAsUtcMidnight(date: string): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString();
}

export function projectItemToCalendar(item: Item): CalendarProjection | null {
  if (item.deleted_at !== null) return null;

  // DATE occurrence range / point — all-day inclusive calendar days.
  if (item.occurrence_start_date || item.occurrence_end_date) {
    const startDate = item.occurrence_start_date ?? item.occurrence_end_date!;
    const endDate = item.occurrence_end_date ?? item.occurrence_start_date!;
    return {
      item_id: item.id,
      start: dateAsUtcMidnight(startDate),
      // Exclusive end-of-range for continuous spanning: use next midnight of end date.
      end: nextDateAsUtcMidnight(endDate),
      kind: startDate === endDate ? "POINT" : "RANGE",
      all_day: true,
    };
  }
  if (item.occurrence_start_at && item.occurrence_end_at) {
    return {
      item_id: item.id,
      start: item.occurrence_start_at,
      end: item.occurrence_end_at,
      kind: "RANGE",
      all_day: false,
    };
  }
  // DATE start + due as a span
  if (item.start_date && item.due_date) {
    return {
      item_id: item.id,
      start: dateAsUtcMidnight(item.start_date),
      end: nextDateAsUtcMidnight(item.due_date),
      kind: "RANGE",
      all_day: true,
    };
  }
  if (item.start_at && item.due_at) {
    return {
      item_id: item.id,
      start: item.start_at,
      end: item.due_at,
      kind: "RANGE",
      all_day: false,
    };
  }

  // Point cases
  if (
    item.due_date &&
    !item.due_at &&
    !item.occurrence_start_at &&
    !item.start_at
  ) {
    return {
      item_id: item.id,
      start: dateAsUtcMidnight(item.due_date),
      end: nextDateAsUtcMidnight(item.due_date),
      kind: "POINT",
      all_day: true,
    };
  }
  if (
    item.start_date &&
    !item.start_at &&
    !item.due_at &&
    !item.occurrence_start_at
  ) {
    return {
      item_id: item.id,
      start: dateAsUtcMidnight(item.start_date),
      end: nextDateAsUtcMidnight(item.start_date),
      kind: "POINT",
      all_day: true,
    };
  }

  const point = [
    item.occurrence_start_at,
    item.due_at,
    item.start_at,
    item.occurrence_end_at,
  ]
    .filter((value): value is string => value !== null)
    .sort()[0];
  return point
    ? {
        item_id: item.id,
        start: point,
        end: point,
        kind: "POINT",
        all_day: false,
      }
    : null;
}

export function calendarItems(
  items: readonly Item[],
  from: string,
  to: string,
): CalendarProjection[] {
  return items.flatMap((item) => {
    const projection = projectItemToCalendar(item);
    return projection && projection.start <= to && projection.end >= from
      ? [projection]
      : [];
  });
}

export function semesterForDate(
  date: string,
  semesters: readonly Semester[],
): Semester | null {
  return (
    semesters.find(
      (semester) =>
        semester.deleted_at === null &&
        semester.start_date <= date &&
        semester.end_date >= date,
    ) ?? null
  );
}

export function semesterForMonth(
  year: number,
  month: number,
  semesters: readonly Semester[],
): Semester | null {
  const first = `${year}-${String(month).padStart(2, "0")}-01`;
  const last = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return (
    semesters.find(
      (semester) =>
        semester.deleted_at === null &&
        semester.start_date <= last &&
        semester.end_date >= first,
    ) ?? null
  );
}

export function semesterWeekForDate(
  date: string,
  semesterId: string,
  weeks: readonly SemesterWeek[],
): number | null {
  return (
    weeks.find(
      (week) =>
        week.semester_id === semesterId &&
        week.start_date <= date &&
        week.end_date >= date,
    )?.week_number ?? null
  );
}

export function visibleOverviewItems(
  items: readonly Item[],
  courses: readonly Course[],
  semesters: readonly Semester[],
  today: string,
  selectedSemesterId?: string,
): Item[] {
  const activeId =
    selectedSemesterId ?? semesterForDate(today, semesters)?.id ?? null;
  const courseById = new Map(
    courses
      .filter((course) => course.deleted_at === null)
      .map((course) => [course.id, course]),
  );
  const semesterById = new Map(
    semesters.map((semester) => [semester.id, semester]),
  );
  return items.filter((item) => {
    if (item.deleted_at !== null) return false;
    if (item.course_id === null) return true;
    const course = courseById.get(item.course_id);
    if (!course) return false;
    if (course.semester_id === null || course.semester_id === activeId)
      return true;
    if (selectedSemesterId) return false;
    const courseSemester = semesterById.get(course.semester_id);
    return (
      item.status === "INCOMPLETE" &&
      Boolean(courseSemester && courseSemester.end_date < today)
    );
  });
}

export function canonicalAssociationPair(
  a: string,
  b: string,
): [string, string] {
  if (a === b) throw new Error("An Item cannot be associated with itself");
  return a < b ? [a, b] : [b, a];
}
