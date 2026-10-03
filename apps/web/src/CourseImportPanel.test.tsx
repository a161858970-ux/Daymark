import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { CourseImportJob } from "@course-manager/contracts";
import { CourseImportReview } from "./CourseImportPanel.js";

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
