import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { CourseImportJob } from "@course-manager/contracts";
import {
  CourseImportReview,
  committedMessage,
  importFailureNote,
} from "./CourseImportPanel.js";

const job: CourseImportJob = {
  id: "11111111-1111-4111-8111-111111111111",
  semester_id: "22222222-2222-4222-8222-222222222222",
  source_type: "PDF",
  status: "NEEDS_RESOLUTION",
  source_name: "课程表.pdf",
  courses: [
    {
      name: "环境经济学",
      instructor: "林老师",
      schedules: [
        {
          weekday: 2,
          start_time: "09:00",
          end_time: "10:30",
          week_start: 1,
          week_end: 14,
          classroom: "A101",
          stage_label: null,
        },
      ],
      duplicate_candidates: [
        {
          id: "33333333-3333-4333-8333-333333333333",
          name: "环境经济学",
          semester_id: "44444444-4444-4444-8444-444444444444",
        },
      ],
      resolution: null,
    },
  ],
  error_message: null,
  result: null,
  created_at: "2026-09-24T08:00:00.000Z",
  updated_at: "2026-09-24T08:00:00.000Z",
  committed_at: null,
};

it("keeps import as a reviewable Course flow with an explicit duplicate decision", () => {
  const markup = renderToStaticMarkup(
    <CourseImportReview
      job={job}
      busy={false}
      onResolve={() => undefined}
      onCommit={() => undefined}
      onDiscard={() => undefined}
    />,
  );
  expect(markup).toContain("识别预览");
  expect(markup).toContain("环境经济学");
  expect(markup).toContain("周二 09:00–10:30 · 第 1–14 周 · A101");
  expect(markup).toContain("上一学期有严格同名课程");
  expect(markup).toContain("只继承课程信息，不复制历史事项或旧课表");
  expect(markup).toContain("是同一门，继承课程信息");
  expect(markup).toContain("不是，作为新课程");
  expect(markup).toContain("请先确认同名课程");
  expect(markup).toContain("放弃本次识别");
  expect(markup).toContain("disabled");
  expect(markup).not.toContain("自动生成事项");
});

it("shows the period label instead of a clock time when the source has none", () => {
  const undated: CourseImportJob = {
    ...job,
    courses: [
      {
        ...job.courses[0]!,
        schedules: [
          {
            weekday: 3,
            start_time: null,
            end_time: null,
            week_start: 1,
            week_end: 16,
            classroom: null,
            stage_label: "12-13节",
          },
        ],
      },
    ],
  };
  const markup = renderToStaticMarkup(
    <CourseImportReview
      job={undated}
      busy={false}
      onResolve={() => undefined}
      onCommit={() => undefined}
      onDiscard={() => undefined}
    />,
  );
  expect(markup).toContain("周三 12-13节 · 第 1–16 周");
  expect(markup).not.toContain("--");
});

it("shows the stored failure reason for a failed import instead of a generic hint", () => {
  const failed: CourseImportJob = {
    ...job,
    status: "FAILED",
    error_message: "识别服务响应超时，文件已保留，请稍后再试。",
  };
  expect(importFailureNote(failed)).toBe(
    "识别服务响应超时，文件已保留，请稍后再试。",
  );
  // Older rows without a stored message still get an accurate fallback.
  expect(importFailureNote({ ...failed, error_message: null })).toBe(
    "上次识别没有写入任何课程，可以重新选择更清晰的文件。",
  );
  // Anything that is not FAILED shows no failure note at all.
  expect(importFailureNote(job)).toBeNull();
  expect(importFailureNote(null)).toBeNull();
});

it("tells the truth about what a commit did", () => {
  expect(
    committedMessage({ course_ids: ["a", "b"], reused_existing_import: false }),
  ).toBe("已建立 2 门课程。");
  const reused = committedMessage({
    course_ids: ["a", "b"],
    reused_existing_import: true,
  });
  expect(reused).toContain("未重复建立");
  expect(reused).not.toContain("已建立 2");
});
