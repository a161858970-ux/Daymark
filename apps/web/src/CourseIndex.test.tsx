import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { Course, Semester } from "@course-manager/domain";
import { CourseIndex } from "./CourseIndex.js";

const ownerId = "11111111-1111-4111-8111-111111111111";
const semester: Semester = {
  id: "22222222-2222-4222-8222-222222222222",
  owner_id: ownerId,
  name: "2026 秋季学期",
  start_date: "2026-09-01",
  end_date: "2026-12-31",
  created_at: "2026-09-01T00:00:00.000Z",
  updated_at: "2026-09-01T00:00:00.000Z",
  deleted_at: null,
  row_version: 1,
};
const course: Course = {
  id: "33333333-3333-4333-8333-333333333333",
  owner_id: ownerId,
  semester_id: semester.id,
  name: "环境经济学",
  instructor: null,
  created_at: "2026-09-01T00:00:00.000Z",
  updated_at: "2026-09-01T00:00:00.000Z",
  deleted_at: null,
  row_version: 1,
};

it("presents courses as an index with incomplete counts and a quiet add entry", () => {
  const markup = renderToStaticMarkup(
    <CourseIndex
      courses={[course]}
      targetSemesterId={semester.id}
      semester={semester}
      weeks={[]}
      incompleteCounts={{ [course.id]: 3 }}
      onOpen={() => undefined}
      onFindCandidate={async () => null}
      onCreateCourse={async () => undefined}
      onCreateSemester={async () => undefined}
      onReplaceWeeks={async () => undefined}
      courseImportAvailable={false}
      onLoadPendingImports={async () => []}
      onStartImport={async () => {
        throw new Error("unused");
      }}
      onRetryImport={async () => {
        throw new Error("unused");
      }}
      onResolveImport={async () => {
        throw new Error("unused");
      }}
      onCommitImport={async () => {
        throw new Error("unused");
      }}
      onImportCommitted={async () => undefined}
      onDiscardImport={async () => undefined}
    />,
  );
  expect(markup).toContain("课程索引");
  expect(markup).toContain("环境经济学");
  expect(markup).toContain("3 项未完成");
  expect(markup).toContain("＋ 添加课程");
  expect(markup).toContain("导入课程表");
  expect(markup).not.toContain('aria-label="课程名称"');
});
