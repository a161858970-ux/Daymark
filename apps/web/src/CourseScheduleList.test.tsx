import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { CourseSchedule } from "@daymark/domain";
import {
  CourseScheduleList,
  buildScheduleReplace,
} from "./CourseScheduleList.js";

const first: CourseSchedule = {
  id: "33333333-3333-4333-8333-333333333333",
  owner_id: "11111111-1111-4111-8111-111111111111",
  course_id: "44444444-4444-4444-8444-444444444444",
  weekday: 1,
  start_time: "08:00:00",
  end_time: "09:30:00",
  week_start: null,
  week_end: null,
  classroom: "101",
  stage_label: null,
  created_at: "2026-09-28T00:21:30.744Z",
  updated_at: "2026-09-28T00:21:30.744Z",
  deleted_at: null,
  row_version: 1,
};

const second: CourseSchedule = {
  ...first,
  id: "55555555-5555-4555-8555-555555555555",
  weekday: 3,
  start_time: "14:00:00",
  end_time: "15:30:00",
  classroom: "A202",
};

const entry = {
  weekday: 5,
  start_time: "10:00:00",
  end_time: "11:30:00",
  week_start: 1,
  week_end: 16,
  classroom: "B101",
  stage_label: null,
};

it("offers an edit and a remove action for every existing schedule", () => {
  const markup = renderToStaticMarkup(
    <CourseScheduleList schedules={[first]} onReplace={async () => {}} />,
  );
  expect(markup).toContain("周一 08:00–09:30 · 101");
  expect(markup).toContain("编辑");
  expect(markup).toContain("移除");
  expect(markup).toContain("添加安排");
});

it("appends a new entry when nothing is being edited", () => {
  expect(buildScheduleReplace([first], null, entry)).toEqual([
    {
      weekday: 1,
      start_time: "08:00:00",
      end_time: "09:30:00",
      week_start: null,
      week_end: null,
      classroom: "101",
      stage_label: null,
    },
    entry,
  ]);
});

it("swaps only the edited entry and keeps the rest in order", () => {
  const replaced = buildScheduleReplace([first, second], first.id, entry);
  expect(replaced).toHaveLength(2);
  expect(replaced[0]).toEqual(entry);
  expect(replaced[1]).toEqual({
    weekday: 3,
    start_time: "14:00:00",
    end_time: "15:30:00",
    week_start: null,
    week_end: null,
    classroom: "A202",
    stage_label: null,
  });
});

it("appends when the editing id no longer exists instead of dropping data", () => {
  const replaced = buildScheduleReplace(
    [first],
    "99999999-9999-4999-8999-999999999999",
    entry,
  );
  expect(replaced).toHaveLength(2);
  expect(replaced[1]).toEqual(entry);
});

it("shows the period label and a time placeholder for an undated row", () => {
  const undated: CourseSchedule = {
    ...first,
    weekday: 5,
    start_time: null,
    end_time: null,
    classroom: null,
    stage_label: "12-13节",
  };
  const markup = renderToStaticMarkup(
    <CourseScheduleList schedules={[undated]} onReplace={async () => {}} />,
  );
  expect(markup).toContain("</strong> 12-13节");
  expect(markup).toContain("暂无时间");
  expect(markup).not.toContain("时间待定");
});

it("keeps a fully empty time pair when building a replace", () => {
  const replaced = buildScheduleReplace([first], null, {
    ...entry,
    start_time: null,
    end_time: null,
  });
  expect(replaced.at(-1)).toMatchObject({
    start_time: null,
    end_time: null,
    weekday: 5,
  });
});
