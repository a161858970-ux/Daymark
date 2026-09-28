import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ConflictPanel } from "./ConflictPanel.js";

it("shows only fields that need a user decision", () => {
  const html = renderToStaticMarkup(
    <ConflictPanel
      defaultExpanded
      conflicts={[
        {
          conflict: {
            id: "11111111-1111-4111-8111-111111111111",
            owner_id: "22222222-2222-4222-8222-222222222222",
            entity_type: "ITEM",
            entity_id: "33333333-3333-4333-8333-333333333333",
            local_version: {
              title: "本机标题",
              detail: "不应展示的本机详情",
            },
            remote_version: {
              title: "云端标题",
              detail: "不应展示的云端详情",
            },
            conflicting_fields: ["title"],
            status: "OPEN",
            created_at: "2026-09-22T08:00:00Z",
            resolved_at: null,
          },
          current_entity: {
            id: "33333333-3333-4333-8333-333333333333",
            title: "云端标题",
            detail: "不应展示的云端详情",
            row_version: 3,
          },
        },
      ]}
      courses={[]}
      onResolve={async () => {}}
    />,
  );
  expect(html).toContain("本机标题");
  expect(html).toContain("云端标题");
  expect(html).toContain("自定义值");
  expect(html).not.toContain("不应展示的本机详情");
  expect(html).not.toContain("不应展示的云端详情");
  expect(html).not.toContain("row_version");
});

it("does not offer a local overwrite for an already deleted object", () => {
  const html = renderToStaticMarkup(
    <ConflictPanel
      defaultExpanded
      conflicts={[
        {
          conflict: {
            id: "11111111-1111-4111-8111-111111111111",
            owner_id: "22222222-2222-4222-8222-222222222222",
            entity_type: "COURSE_INFORMATION",
            entity_id: "33333333-3333-4333-8333-333333333333",
            local_version: { content: "本机内容" },
            remote_version: { content: "远端内容" },
            conflicting_fields: ["content"],
            status: "OPEN",
            created_at: "2026-09-22T08:00:00Z",
            resolved_at: null,
          },
          current_entity: {
            id: "33333333-3333-4333-8333-333333333333",
            content: "远端内容",
            deleted_at: "2026-09-22T09:00:00Z",
            row_version: 4,
          },
        },
      ]}
      courses={[]}
      onResolve={async () => {}}
    />,
  );
  expect(html).toContain("已在另一设备删除");
  expect(html.match(/<input[^>]*type="radio"[^>]*>/)?.[0]).toContain(
    'disabled=""',
  );
});

it("summarizes a collection conflict without exposing sync internals", () => {
  const courseId = "33333333-3333-4333-8333-333333333333";
  const html = renderToStaticMarkup(
    <ConflictPanel
      defaultExpanded
      conflicts={[
        {
          conflict: {
            id: "11111111-1111-4111-8111-111111111111",
            owner_id: "22222222-2222-4222-8222-222222222222",
            entity_type: "COURSE_SCHEDULE_COLLECTION",
            entity_id: courseId,
            local_version: {
              base_version: 1,
              collection: [{ id: "local-a" }, { id: "local-b" }],
            },
            remote_version: {
              row_version: 2,
              collection: [{ id: "remote-a" }],
            },
            conflicting_fields: ["collection"],
            status: "OPEN",
            created_at: "2026-09-23T08:00:00Z",
            resolved_at: null,
          },
          current_entity: {
            id: courseId,
            owner_id: "22222222-2222-4222-8222-222222222222",
            row_version: 2,
            collection: [{ id: "remote-a" }],
          },
        },
      ]}
      courses={[
        {
          id: courseId,
          owner_id: "22222222-2222-4222-8222-222222222222",
          semester_id: null,
          name: "统计学",
          instructor: null,
          created_at: "2026-09-23T08:00:00Z",
          updated_at: "2026-09-23T08:00:00Z",
          deleted_at: null,
          row_version: 1,
        },
      ]}
      onResolve={async () => {}}
    />,
  );
  expect(html).toContain("统计学");
  expect(html).toContain("2 条记录");
  expect(html).toContain("1 条记录");
  expect(html).toContain("整体保存");
  expect(html).not.toContain("base_version");
  expect(html).not.toContain("row_version");
  expect(html).not.toContain("local-a");
});

it("shows what each whole-group option contains so the choice is comparable", () => {
  const html = renderToStaticMarkup(
    <ConflictPanel
      defaultExpanded
      conflicts={[
        {
          conflict: {
            id: "11111111-1111-4111-8111-111111111111",
            owner_id: "22222222-2222-4222-8222-222222222222",
            entity_type: "COURSE_SCHEDULE_COLLECTION",
            entity_id: "44444444-4444-4444-8444-444444444444",
            local_version: {
              base_version: 5,
              collection: [
                {
                  weekday: 1,
                  start_time: "12:00:00",
                  end_time: "14:30:00",
                  week_start: 1,
                  week_end: null,
                  classroom: "103",
                  stage_label: null,
                },
              ],
            },
            remote_version: {
              row_version: 6,
              collection: [
                {
                  weekday: 1,
                  start_time: "08:00:00",
                  end_time: "09:30:00",
                  week_start: 1,
                  week_end: null,
                  classroom: "303",
                  stage_label: null,
                },
              ],
            },
            conflicting_fields: ["collection"],
            status: "OPEN",
            created_at: "2026-09-28T01:29:24Z",
            resolved_at: null,
          },
          current_entity: {
            id: "44444444-4444-4444-8444-444444444444",
            row_version: 6,
            deleted_at: null,
            collection: [
              {
                weekday: 1,
                start_time: "08:00:00",
                end_time: "09:30:00",
                week_start: 1,
                week_end: null,
                classroom: "303",
                stage_label: null,
              },
            ],
          },
        },
      ]}
      courses={[]}
      onResolve={async () => {}}
    />,
  );
  // Both sides are spelled out line by line, not just "1 条记录".
  expect(html).toContain("周一 12:00–14:30 · 第1周 · 103");
  expect(html).toContain("周一 08:00–09:30 · 第1周 · 303");
  expect(html).toContain("本机记录");
  expect(html).toContain("已同步记录");
  // Whole-group conflicts offer exactly the two groups, never a mixed value.
  expect(html).not.toContain("自定义值");
});
