import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { Course, Item } from "@course-manager/domain";
import { ItemList } from "./ItemList.js";

const course: Course = {
  id: "11111111-1111-4111-8111-111111111111",
  owner_id: "22222222-2222-4222-8222-222222222222",
  semester_id: null,
  name: "环境经济学",
  instructor: null,
  created_at: "2026-09-24T08:00:00.000Z",
  updated_at: "2026-09-24T08:00:00.000Z",
  deleted_at: null,
  row_version: 1,
};

const item: Item = {
  id: "33333333-3333-4333-8333-333333333333",
  owner_id: course.owner_id,
  course_id: course.id,
  title: "提交课程报告",
  detail: null,
  status: "INCOMPLETE",
  start_at: null,
  occurrence_start_at: null,
  occurrence_end_at: null,
  due_at: "2026-09-30T10:00:00.000Z",
  reminder_level: "NORMAL",
  completed_at: null,
  raw_capture_id: null,
  created_at: "2026-09-24T08:00:00.000Z",
  updated_at: "2026-09-24T08:00:00.000Z",
  deleted_at: null,
  row_version: 1,
};

it("keeps completion and item detail as separate targets", () => {
  const markup = renderToStaticMarkup(
    <ItemList
      items={[item]}
      courses={[course]}
      pendingMoveIds={new Set()}
      selectedItemId={item.id}
      onOpen={() => undefined}
      onComplete={() => undefined}
    />,
  );
  expect(markup).toContain('aria-label="完成 提交课程报告"');
  expect(markup).toContain('class="item-body"');
  expect(markup).toContain('aria-current="true"');
  expect(markup).toContain("环境经济学 · 截止");
});
