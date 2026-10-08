import { expect, it } from "vitest";
import type { Course, CourseInformation, Item } from "./entities.js";
import { searchDaymarkRecords } from "./search.js";

const base = {
  owner_id: "owner",
  created_at: "2026-09-01T00:00:00.000Z",
  updated_at: "2026-09-01T00:00:00.000Z",
  deleted_at: null,
  row_version: 1,
};

const course: Course = {
  ...base,
  id: "course",
  semester_id: null,
  name: "环境经济学",
  instructor: "林老师",
};
const item: Item = {
  ...base,
  id: "item",
  course_id: course.id,
  title: "准备演讲 PPT",
  detail: "第五章案例",
  status: "INCOMPLETE",
  start_at: null,
  occurrence_start_at: null,
  occurrence_end_at: null,
  due_at: null,
  reminder_level: "NORMAL",
  completed_at: null,
  raw_capture_id: null,
};
const information: CourseInformation = {
  ...base,
  id: "information",
  course_id: course.id,
  content: "老师主要使用 PPT 和课本",
};

it("matches local records by keyword without inventing a ranked result order", () => {
  const secondItem = { ...item, id: "second", title: "ppt 复习提纲" };
  const results = searchDaymarkRecords("ＰＰＴ", {
    items: [item, secondItem],
    courses: [course],
    courseInformation: [information],
  });
  expect(results.items.map((value) => value.id)).toEqual(["item", "second"]);
  expect(results.courses).toEqual([]);
  expect(results.courseInformation.map((value) => value.id)).toEqual([
    "information",
  ]);
});

it("matches secondary readable fields and excludes deleted records", () => {
  expect(
    searchDaymarkRecords("林老师", {
      items: [],
      courses: [course],
      courseInformation: [],
    }).courses,
  ).toEqual([course]);
  expect(
    searchDaymarkRecords("第五章", {
      items: [{ ...item, deleted_at: "2026-09-02T00:00:00.000Z" }],
      courses: [],
      courseInformation: [],
    }).items,
  ).toEqual([]);
});
