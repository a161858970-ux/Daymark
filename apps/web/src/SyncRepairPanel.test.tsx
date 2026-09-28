import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { SyncRepairPanel } from "./SyncRepairPanel.js";

it("shows the affected object and safe repair choices without queue internals", () => {
  const html = renderToStaticMarkup(
    <SyncRepairPanel
      defaultExpanded
      issues={[
        {
          mutation: {
            mutation_id: "11111111-1111-4111-8111-111111111111",
            owner_id: "22222222-2222-4222-8222-222222222222",
            entity_type: "ITEM",
            entity_id: "33333333-3333-4333-8333-333333333333",
            operation: "UPDATE",
            base_version: 1,
            changed_fields: { title: "已修复标题" },
            created_at: "2026-09-23T08:00:00Z",
            attempt_count: 1,
            last_error: "VALIDATION_ERROR: internal validator detail",
            acked_at: null,
          },
          local_object: {
            id: "33333333-3333-4333-8333-333333333333",
            title: "已修复标题",
          },
          error_code: "VALIDATION_ERROR",
          can_retry: true,
          can_abandon: true,
        },
      ]}
      courses={[]}
      onInspect={() => {}}
      onRetry={async () => {}}
      onAbandon={async () => {}}
    />,
  );
  expect(html).toContain("已修复标题");
  expect(html).toContain("重新提交当前内容");
  expect(html).toContain("采用已同步状态");
  expect(html).not.toContain("11111111-1111");
  expect(html).not.toContain("internal validator detail");
  expect(html).not.toContain("base_version");
});

it("opens itself when the account panel signals it", () => {
  const html = renderToStaticMarkup(
    <SyncRepairPanel
      openSignal={1}
      issues={[
        {
          mutation: {
            mutation_id: "11111111-1111-4111-8111-111111111111",
            owner_id: "22222222-2222-4222-8222-222222222222",
            entity_type: "ITEM",
            entity_id: "33333333-3333-4333-8333-333333333333",
            operation: "UPDATE",
            base_version: 1,
            changed_fields: { title: "被拒绝的标题" },
            created_at: "2026-09-28T08:00:00Z",
            attempt_count: 1,
            last_error: "FORBIDDEN: owner mismatch",
            acked_at: null,
          },
          local_object: {
            id: "33333333-3333-4333-8333-333333333333",
            title: "被拒绝的标题",
          },
          error_code: "FORBIDDEN",
          can_retry: true,
          can_abandon: true,
        },
      ]}
      courses={[]}
      onInspect={() => {}}
      onRetry={async () => {}}
      onAbandon={async () => {}}
    />,
  );
  // openSignal>0 时首帧即展开：能直接看到问题明细与处理出口
  expect(html).toContain("被拒绝的标题");
  expect(html).toContain("重新提交");
});
