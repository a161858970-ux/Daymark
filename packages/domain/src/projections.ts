import type { Course, Item, Semester, SemesterWeek } from "./entities.js";

export function hasItemTime(item: Item): boolean {
  return Boolean(
    item.start_at ||
    item.occurrence_start_at ||
    item.occurrence_end_at ||
    item.due_at,
  );
}

/** Canonical query-time key from 15_DATABASE_SCHEMA §9.3. */
export function overviewSortAt(item: Item, now: string): string | null {
  const times = [
    item.due_at,
    item.occurrence_start_at,
    item.start_at,
    item.occurrence_end_at,
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
}

export function projectItemToCalendar(item: Item): CalendarProjection | null {
  if (item.deleted_at !== null) return null;
  if (item.occurrence_start_at && item.occurrence_end_at) {
    return {
      item_id: item.id,
      start: item.occurrence_start_at,
      end: item.occurrence_end_at,
      kind: "RANGE",
    };
  }
  if (item.start_at && item.due_at) {
    return {
      item_id: item.id,
      start: item.start_at,
      end: item.due_at,
      kind: "RANGE",
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
    ? { item_id: item.id, start: point, end: point, kind: "POINT" }
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
