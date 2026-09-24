import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import type { Course, Item, RawCapture } from "@course-manager/domain";
import { ItemDetail } from "./ItemDetail.js";

const ownerId = "22222222-2222-4222-8222-222222222222";
const course: Course = {
  id: "11111111-1111-4111-8111-111111111111",
  owner_id: ownerId,
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
  owner_id: ownerId,
  course_id: course.id,
  title: "提交课程报告",
  detail: "附上参考文献。",
  status: "INCOMPLETE",
  start_at: null,
  occurrence_start_at: null,
  occurrence_end_at: null,
  due_at: "2026-09-30T10:00:00.000Z",
  reminder_level: "NORMAL",
  completed_at: null,
  raw_capture_id: "44444444-4444-4444-8444-444444444444",
  created_at: "2026-09-24T08:00:00.000Z",
  updated_at: "2026-09-24T08:00:00.000Z",
  deleted_at: null,
  row_version: 1,
};

const rawCapture: RawCapture = {
  id: item.raw_capture_id!,
  owner_id: ownerId,
  source: "QUICK_CAPTURE",
  raw_text: "环境经济学报告 9月30日交",
  captured_at: "2026-09-24T08:00:00.000Z",
  processing_status: "RESOLVED",
  unresolved_reason: null,
  deleted_at: null,
  row_version: 1,
};

afterEach(() => vi.unstubAllGlobals());

it("keeps view, edit, status, provenance, and delete actions in one detail container", () => {
  const markup = renderToStaticMarkup(
    <ItemDetail
      item={item}
      courses={[course]}
      rawCapture={rawCapture}
      associations={[]}
      associationCandidates={[]}
      onClose={() => undefined}
      onComplete={() => undefined}
      onRestore={() => undefined}
      onDelete={async () => true}
      onSave={async () => undefined}
      onAssociate={async () => undefined}
      onRemoveAssociation={async () => undefined}
    />,
  );
  expect(markup).toContain('role="dialog"');
  expect(markup).toContain(`data-item-id="${item.id}"`);
  expect(markup).toContain('class="sheet-handle"');
  expect(markup).toContain('class="detail-facts"');
  expect(markup).toContain("环境经济学");
  expect(markup).toContain("完成事项");
  expect(markup).toContain("编辑");
  expect(markup).toContain("原始记录");
  expect(markup).toContain("删除事项");
});

it("announces the mobile bottom sheet as modal and hides its pointer backdrop", () => {
  vi.stubGlobal("window", {
    matchMedia: (query: string) => ({
      matches: query === "(max-width: 767px)",
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
  const markup = renderToStaticMarkup(
    <ItemDetail
      item={item}
      courses={[course]}
      rawCapture={rawCapture}
      associations={[]}
      associationCandidates={[]}
      onClose={() => undefined}
      onComplete={() => undefined}
      onRestore={() => undefined}
      onDelete={async () => true}
      onSave={async () => undefined}
      onAssociate={async () => undefined}
      onRemoveAssociation={async () => undefined}
    />,
  );
  expect(markup).toContain('role="dialog" aria-modal="true"');
  expect(markup).toContain('class="detail-backdrop " aria-hidden="true"');
});
