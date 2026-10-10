import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { CalendarWeekRow, Course, Item } from "@daymark/domain";
import {
  CalendarDayView,
  calendarDayHeading,
  calendarItemTimeLabel,
} from "./CalendarDayView.js";
import { CalendarGrid, calendarPositionSignatures } from "./CalendarGrid.js";
import { I18nProvider } from "./i18n/index.js";

const ownerId = "22222222-2222-4222-8222-222222222222";
const course: Course = {
  id: "11111111-1111-4111-8111-111111111111",
  owner_id: ownerId,
  semester_id: null,
  name: "环境经济学",
  instructor: null,
  created_at: "2026-09-01T00:00:00.000Z",
  updated_at: "2026-09-01T00:00:00.000Z",
  deleted_at: null,
  row_version: 1,
};

const item = (id: string, patch: Partial<Item> = {}): Item => ({
  id,
  owner_id: ownerId,
  course_id: course.id,
  title: id,
  detail: null,
  status: "INCOMPLETE",
  start_at: null,
  start_date: null,
  occurrence_start_at: null,
  occurrence_start_date: null,
  occurrence_end_at: null,
  occurrence_end_date: null,
  due_at: null,
  due_date: null,
  time_zone: "UTC",
  reminder_level: "NORMAL",
  completed_at: null,
  raw_capture_id: null,
  created_at: "2026-09-01T00:00:00.000Z",
  updated_at: "2026-09-01T00:00:00.000Z",
  deleted_at: null,
  row_version: 1,
  ...patch,
});

const range = item("准备课程论文", {
  occurrence_start_at: "2026-09-21T10:00:00.000Z",
  occurrence_end_at: "2026-09-25T12:00:00.000Z",
  status: "COMPLETE",
  completed_at: "2026-09-24T08:00:00.000Z",
});
const point = item("课堂演讲", {
  due_at: "2026-09-22T18:00:00.000Z",
});

const week: CalendarWeekRow = {
  start_date: "2026-09-21",
  end_date: "2026-09-27",
  semester_week: 4,
  days: Array.from({ length: 7 }, (_, index) => ({
    date: `2026-09-${String(21 + index).padStart(2, "0")}`,
    in_visible_month: true,
  })),
  segments: [
    {
      item_id: range.id,
      kind: "RANGE",
      start_column: 1,
      end_column: 5,
      begins_here: false,
      ends_here: false,
    },
    {
      item_id: point.id,
      kind: "POINT",
      start_column: 2,
      end_column: 2,
      begins_here: true,
      ends_here: true,
    },
  ],
};

it("renders one continuous range and makes the whole mobile date the drill-down target", () => {
  const markup = renderToStaticMarkup(
    <I18nProvider initialLocale="zh-CN">
      <CalendarGrid
        weeks={[week]}
        items={[range, point]}
        mode="month"
        today="2026-09-24"
        selectedDate="2026-09-22"
        onSelectDate={() => undefined}
        onOpen={() => undefined}
      />
    </I18nProvider>,
  );
  expect(markup).toContain('aria-label="2026-09-22，2 项事项，已选择"');
  expect(markup).toContain('aria-current="date"');
  expect(markup).toContain("range continues-before continues-after complete");
  expect(markup.match(/title="准备课程论文"/g)).toHaveLength(1);
});

it("presents day items with time, course, and non-color completion meaning", () => {
  expect(calendarDayHeading("2026-09-24", "zh-CN")).toBe("9月24日 · 星期四");
  expect(calendarItemTimeLabel(range, "2026-09-24", "UTC", "zh-CN")).toContain(
    "持续事项",
  );
  expect(calendarItemTimeLabel(point, "2026-09-22", "UTC", "zh-CN")).toBe(
    "截止 18:00",
  );
  const markup = renderToStaticMarkup(
    <I18nProvider initialLocale="zh-CN">
      <CalendarDayView
        date="2026-09-24"
        items={[range]}
        courses={[course]}
        timeZone="UTC"
        onOpen={() => undefined}
        onBack={() => undefined}
      />
    </I18nProvider>,
  );
  expect(markup).toContain("9月24日 · 星期四");
  expect(markup).toContain("环境经济学 · 已完成");
  expect(markup).toContain('class="calendar-day-status"');
});

it("tracks one calendar identity by its projected position", () => {
  const positions = calendarPositionSignatures([week]);
  expect(positions.get(range.id)).toBe("2026-09-21:1-5");
  expect(positions.get(point.id)).toBe("2026-09-21:2-2");
});
