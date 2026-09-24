import type { Course, CourseInformation, Item } from "./entities.js";

export interface CourseManagerSearchResults {
  items: Item[];
  courses: Course[];
  courseInformation: CourseInformation[];
}

function normalized(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("zh-CN");
}

function contains(value: string | null, query: string): boolean {
  return Boolean(value && normalized(value).includes(query));
}

/**
 * Deterministic local keyword matching. Results preserve source order and are
 * grouped by object type; there is no inferred relevance or AI ranking.
 */
export function searchCourseManagerRecords(
  query: string,
  records: {
    items: readonly Item[];
    courses: readonly Course[];
    courseInformation: readonly CourseInformation[];
  },
): CourseManagerSearchResults {
  const needle = normalized(query.trim());
  if (!needle) return { items: [], courses: [], courseInformation: [] };
  return {
    items: records.items.filter(
      (item) =>
        item.deleted_at === null &&
        (contains(item.title, needle) || contains(item.detail, needle)),
    ),
    courses: records.courses.filter(
      (course) =>
        course.deleted_at === null &&
        (contains(course.name, needle) || contains(course.instructor, needle)),
    ),
    courseInformation: records.courseInformation.filter(
      (entry) => entry.deleted_at === null && contains(entry.content, needle),
    ),
  };
}
