import type { CourseSchedule } from "@course-manager/domain";

export type ScheduleFields = Pick<
  CourseSchedule,
  | "weekday"
  | "start_time"
  | "end_time"
  | "week_start"
  | "week_end"
  | "classroom"
  | "stage_label"
>;

export const weekdays = [
  "周一",
  "周二",
  "周三",
  "周四",
  "周五",
  "周六",
  "周日",
];

/**
 * One wording for every surface that shows a schedule row: the list, the
 * editing hint and the conflict comparison must read identically.
 */
export function summaryParts(value: ScheduleFields): {
  weekday: string;
  rest: string;
} {
  let rest = `${value.start_time.slice(0, 5)}–${value.end_time.slice(0, 5)}`;
  if (value.week_start !== null && value.week_start !== undefined) {
    rest += ` · 第${value.week_start}${
      value.week_end !== null &&
      value.week_end !== undefined &&
      value.week_end !== value.week_start
        ? `–${value.week_end}`
        : ""
    }周`;
  }
  if (value.classroom) rest += ` · ${value.classroom}`;
  if (value.stage_label) rest += ` · ${value.stage_label}`;
  return {
    weekday: weekdays[value.weekday - 1] ?? String(value.weekday),
    rest,
  };
}

export function scheduleSummary(value: ScheduleFields): string {
  const parts = summaryParts(value);
  return `${parts.weekday} ${parts.rest}`;
}
