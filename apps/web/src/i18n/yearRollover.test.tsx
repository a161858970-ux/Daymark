// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { Course, Item } from "@daymark/domain";
import { I18nProvider } from "./index.js";
import { ItemList } from "../ItemList.js";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

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

function itemOf(id: string, dueDate: string, title: string): Item {
  return {
    ...base,
    id,
    course_id: course.id,
    title,
    detail: null,
    status: "INCOMPLETE",
    start_at: null,
    start_date: null,
    occurrence_start_at: null,
    occurrence_start_date: null,
    occurrence_end_at: null,
    occurrence_end_date: null,
    due_at: null,
    due_date: dueDate,
    time_zone: "Asia/Shanghai",
    reminder_level: "NORMAL",
    completed_at: null,
    raw_capture_id: null,
  };
}

async function mountList(items: Item[]): Promise<{
  container: HTMLElement;
  root: Root;
}> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <I18nProvider initialLocale="zh-CN">
        <ItemList
          items={items}
          courses={[course]}
          pendingMoveIds={new Set<string>()}
          onOpen={() => undefined}
          onComplete={() => undefined}
        />
      </I18nProvider>,
    );
  });
  return { container, root };
}

afterEach(() => {
  vi.useRealTimers();
});

it("refreshes mounted list labels when the local year rolls over", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 11, 31, 20, 0, 0));
  const { container, root } = await mountList([
    itemOf("33333333-3333-4333-8333-333333333331", "2026-10-21", "本年事项"),
    itemOf("33333333-3333-4333-8333-333333333332", "2027-01-01", "跨年事项"),
  ]);
  // 2026-12-31: the current-year item hides its year, the next-year item
  // shows it (requirement 1).
  expect(container.innerHTML).toContain("10月21日");
  expect(container.innerHTML).toContain("2027年1月1日");
  expect(container.innerHTML).not.toContain("2026年");
  // Cross the local New Year without any user action: the MOUNTED UI must
  // re-render by itself (requirement 2 + 3 — not just the pure formatter).
  await act(async () => {
    vi.advanceTimersByTime(5 * 60 * 60 * 1000);
  });
  expect(container.innerHTML).toContain("2026年10月21日");
  expect(container.innerHTML).toContain("1月1日");
  expect(container.innerHTML).not.toContain("2027年");
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

it("recalibrates when the window regains focus", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 11, 31, 20, 0, 0));
  const { container, root } = await mountList([
    itemOf("33333333-3333-4333-8333-333333333333", "2026-10-21", "本年事项"),
  ]);
  expect(container.innerHTML).not.toContain("2026年");
  // The clock moves while the year-boundary timer has NOT fired (device
  // slept) — focus must calibrate immediately (requirement 4).
  vi.setSystemTime(new Date(2027, 0, 1, 10, 0, 0));
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
  });
  expect(container.innerHTML).toContain("2026年10月21日");
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

it("recalibrates when the app becomes visible again", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 11, 31, 20, 0, 0));
  const { container, root } = await mountList([
    itemOf("33333333-3333-4333-8333-333333333334", "2026-10-21", "本年事项"),
  ]);
  expect(container.innerHTML).not.toContain("2026年");
  vi.setSystemTime(new Date(2027, 0, 1, 10, 0, 0));
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(container.innerHTML).toContain("2026年10月21日");
  await act(async () => {
    root.unmount();
  });
  container.remove();
});
