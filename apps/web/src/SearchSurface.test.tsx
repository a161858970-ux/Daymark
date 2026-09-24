import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { Course, CourseInformation, Item } from "@course-manager/domain";
import { SearchResultGroups, SearchSurface } from "./SearchSurface.js";

const base = {
  owner_id: "22222222-2222-4222-8222-222222222222",
  created_at: "2026-09-24T08:00:00.000Z",
  updated_at: "2026-09-24T08:00:00.000Z",
  deleted_at: null,
  row_version: 1,
};
const course: Course = {
  ...base,
  id: "11111111-1111-4111-8111-111111111111",
  semester_id: null,
  name: "环境经济学",
  instructor: "林老师",
};
const item: Item = {
  ...base,
  id: "33333333-3333-4333-8333-333333333333",
  course_id: course.id,
  title: "准备演讲 PPT",
  detail: null,
  status: "COMPLETE",
  start_at: null,
  occurrence_start_at: null,
  occurrence_end_at: null,
  due_at: null,
  reminder_level: "NORMAL",
  completed_at: "2026-09-24T09:00:00.000Z",
  raw_capture_id: null,
};
const information: CourseInformation = {
  ...base,
  id: "44444444-4444-4444-8444-444444444444",
  course_id: course.id,
  content: "主要使用 PPT 和课本",
};

it("groups matching canonical objects and keeps completion meaning visible", () => {
  const markup = renderToStaticMarkup(
    <SearchResultGroups
      results={{
        items: [item],
        courses: [course],
        courseInformation: [information],
      }}
      courses={[course]}
      onOpenItem={() => undefined}
      onOpenCourse={() => undefined}
      onOpenInformation={() => undefined}
    />,
  );
  expect(markup).toContain("事项");
  expect(markup).toContain("课程信息");
  expect(markup).toContain("准备演讲 PPT");
  expect(markup).toContain("环境经济学 · 已完成");
  expect(markup).toContain("主要使用 PPT 和课本");
});

it("exposes one modal global search surface rather than a navigation page", () => {
  const markup = renderToStaticMarkup(
    <SearchSurface
      items={[item]}
      courses={[course]}
      courseInformation={[information]}
      onClose={() => undefined}
      onOpenItem={() => undefined}
      onOpenCourse={() => undefined}
      onOpenInformation={() => undefined}
    />,
  );
  expect(markup).toContain('role="dialog"');
  expect(markup).toContain('aria-modal="true"');
  expect(markup).toContain("搜索事项、课程或课程信息");
  expect(markup).toContain("输入关键词，直接定位本机已有记录。");
});
