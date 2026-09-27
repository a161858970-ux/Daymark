import { expect, it } from "vitest";
import type { Item } from "@course-manager/domain";
import { changedItemFields } from "./itemEditDiff.js";

const base: Item = {
  id: "11111111-1111-4111-8111-111111111111",
  owner_id: "22222222-2222-4222-8222-222222222222",
  created_at: "2026-09-27T09:16:25.910Z",
  updated_at: "2026-09-27T09:16:25.910Z",
  deleted_at: null,
  row_version: 4,
  course_id: null,
  title: "明天买东西",
  detail: null,
  status: "INCOMPLETE",
  start_at: "2026-10-16T10:17:00+00:00",
  occurrence_start_at: "2026-10-16T09:16:00+00:00",
  occurrence_end_at: "2026-10-16T09:16:00+00:00",
  due_at: null,
  reminder_level: "NORMAL",
  completed_at: null,
  raw_capture_id: null,
};

const values = {
  title: base.title,
  detail: base.detail,
  course_id: base.course_id,
  start_at: base.start_at,
  occurrence_start_at: base.occurrence_start_at,
  occurrence_end_at: base.occurrence_end_at,
  due_at: base.due_at,
  reminder_level: base.reminder_level,
};

it("submits only the field the user edited", () => {
  expect(
    changedItemFields(base, { ...values, title: "明天买东西-改标题" }),
  ).toEqual({
    title: "明天买东西-改标题",
  });
});

it("submits nothing when the form matches the opened item", () => {
  expect(changedItemFields(base, values)).toEqual({});
});

it("treats the same instant written in another format as unchanged", () => {
  // The form converts through the local input, which emits `…Z` while the
  // row coming back from the server carries `…+00:00`.
  expect(
    changedItemFields(base, {
      ...values,
      start_at: "2026-10-16T10:17:00.000Z",
      occurrence_start_at: "2026-10-16T09:16:00.000Z",
      occurrence_end_at: "2026-10-16T09:16:00.000Z",
    }),
  ).toEqual({});
});

it("keeps a real date change and the title together", () => {
  expect(
    changedItemFields(base, {
      ...values,
      title: "改了标题",
      start_at: "2026-10-20T10:17:00.000Z",
    }),
  ).toEqual({
    title: "改了标题",
    start_at: "2026-10-20T10:17:00.000Z",
  });
});
