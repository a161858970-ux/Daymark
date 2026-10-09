import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { Course, Item } from "@daymark/domain";
import { I18nProvider } from "./i18n/index.js";
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
  start_date: null,
  occurrence_start_at: null,
  occurrence_start_date: null,
  occurrence_end_at: null,
  occurrence_end_date: null,
  due_at: "2026-09-30T10:00:00.000Z",
  due_date: null,
  time_zone: "UTC",
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
    <I18nProvider>
      <ItemList
        items={[item]}
        courses={[course]}
        pendingMoveIds={new Set()}
        selectedItemId={item.id}
        onOpen={() => undefined}
        onComplete={() => undefined}
      />
    </I18nProvider>,
  );
  expect(markup).toContain('aria-label="完成 提交课程报告"');
  expect(markup).toContain('class="item-body"');
  expect(markup).toContain('aria-current="true"');
  expect(markup).toContain("环境经济学 · 截止");
});

it("shows DATE fields as calendar days without inventing 00:00", () => {
  const dueDateItem: Item = {
    ...item,
    due_at: null,
    due_date: "2026-10-12",
  };
  const markup = renderToStaticMarkup(
    <I18nProvider>
      <ItemList
        items={[dueDateItem]}
        courses={[course]}
        pendingMoveIds={new Set()}
        onOpen={() => undefined}
        onComplete={() => undefined}
      />
    </I18nProvider>,
  );
  expect(markup).toContain("10月12日");
  expect(markup).not.toContain("00:00");
  expect(markup).not.toContain("T00:00");
});

it("shows DATE occurrence spans without fake clocks", () => {
  const range: Item = {
    ...item,
    due_at: null,
    due_date: null,
    occurrence_start_date: "2026-10-12",
    occurrence_end_date: "2026-10-14",
  };
  const markup = renderToStaticMarkup(
    <I18nProvider>
      <ItemList
        items={[range]}
        courses={[course]}
        pendingMoveIds={new Set()}
        onOpen={() => undefined}
        onComplete={() => undefined}
      />
    </I18nProvider>,
  );
  expect(markup).toContain("10月12日");
  expect(markup).toContain("10月14日");
  expect(markup).not.toContain("00:00");
});

it("still shows DATETIME dues with a real clock", () => {
  const markup = renderToStaticMarkup(
    <I18nProvider>
      <ItemList
        items={[item]}
        courses={[course]}
        pendingMoveIds={new Set()}
        onOpen={() => undefined}
        onComplete={() => undefined}
      />
    </I18nProvider>,
  );
  // due_at = 2026-09-30T10:00:00.000Z — must include a clock, not only a day.
  expect(markup).toMatch(/截止[^<]*\d{1,2}:\d{2}/);
});

it("exposes the short delete and same-identity re-entry motion states", () => {
  const deleting = renderToStaticMarkup(
    <I18nProvider>
      <ItemList
        items={[item]}
        courses={[course]}
        pendingMoveIds={new Set()}
        pendingDeleteIds={new Set([item.id])}
        onOpen={() => undefined}
        onComplete={() => undefined}
      />
    </I18nProvider>,
  );
  const entering = renderToStaticMarkup(
    <I18nProvider>
      <ItemList
        items={[item]}
        courses={[course]}
        pendingMoveIds={new Set()}
        enteringItemIds={new Set([item.id])}
        onOpen={() => undefined}
        onComplete={() => undefined}
      />
    </I18nProvider>,
  );
  expect(deleting).toContain("item-row deleting");
  expect(deleting).toContain("disabled");
  expect(entering).toContain("item-row entering");
});

it("keeps the completed section collapsed by default with a readable count", () => {
  const completed = {
    ...item,
    id: "44444444-4444-4444-8444-444444444444",
    title: "已经提交的报告",
    status: "COMPLETE" as const,
    completed_at: "2026-09-24T09:00:00.000Z",
  };
  const markup = renderToStaticMarkup(
    <I18nProvider>
      <ItemList
        items={[item, completed]}
        courses={[course]}
        pendingMoveIds={new Set()}
        onOpen={() => undefined}
        onComplete={() => undefined}
      />
    </I18nProvider>,
  );
  expect(markup).toContain("已完成 · 1");
  expect(markup).toContain('aria-expanded="false"');
  expect(markup).not.toContain("已经提交的报告");
});
