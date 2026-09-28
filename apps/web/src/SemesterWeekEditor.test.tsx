import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { Semester, SemesterWeek } from "@course-manager/domain";
import { SemesterWeekEditor } from "./SemesterWeekEditor.js";

const semester: Semester = {
  id: "11111111-1111-4111-8111-111111111111",
  owner_id: "22222222-2222-4222-8222-222222222222",
  name: "2026 秋季学期",
  start_date: "2026-09-01",
  end_date: "2026-12-31",
  created_at: "2026-09-28T00:00:00.000Z",
  updated_at: "2026-09-28T00:00:00.000Z",
  deleted_at: null,
  row_version: 1,
};

const firstWeek: SemesterWeek = {
  id: "33333333-3333-4333-8333-333333333333",
  owner_id: "22222222-2222-4222-8222-222222222222",
  semester_id: semester.id,
  week_number: 1,
  start_date: "2026-09-07",
  end_date: "2026-09-13",
};

it("offers calendar week rows with projected numbers instead of date inputs", () => {
  const markup = renderToStaticMarkup(
    <SemesterWeekEditor
      semester={semester}
      weeks={[firstWeek]}
      onReplace={async () => {}}
    />,
  );
  // No start/end date typing any more (product decision 2026-09-28).
  expect(markup).not.toContain('type="date"');
  // The anchored first week drives projections on later rows.
  expect(markup).toContain("第1周 · 2026-09-07 至 2026-09-13");
  expect(markup).toContain("10.26 – 11.01");
  expect(markup).toContain("第8周");
  expect(markup).toContain("推算");
  expect(markup).toContain("点选补齐第1–第8周");
  // September is shown as its five natural weeks.
  expect(markup).toContain("08.31 – 09.06");
  expect(markup).toContain("09.28 – 10.04");
  expect(markup).toContain("移除");
  // With an anchor in place the manual week number is available again.
  expect(markup).toContain('aria-label="学期周次"');
});

it("asks for the first week instead of inferring anything", () => {
  const markup = renderToStaticMarkup(
    <SemesterWeekEditor
      semester={semester}
      weeks={[]}
      onReplace={async () => {}}
    />,
  );
  expect(markup).toContain("先确定第一周");
  expect(markup).toContain("选为第1周");
  // Nothing is known yet: no projected badges, no manual numbering either.
  expect(markup).not.toContain('class="week-row-projected"');
  expect(markup).not.toContain('aria-label="学期周次"');
  expect(markup).not.toContain('type="date"');
});
