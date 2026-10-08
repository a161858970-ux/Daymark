import type { CourseSchedule } from "@daymark/domain";

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
  const hasTime = Boolean(value.start_time && value.end_time);
  // Without a stated clock time the period label leads the line; with one,
  // the line is unchanged and the period label stays an extra part.
  const parts: string[] = [
    hasTime
      ? `${value.start_time!.slice(0, 5)}–${value.end_time!.slice(0, 5)}`
      : value.stage_label?.trim() || "时间待定",
  ];
  if (value.week_start !== null && value.week_start !== undefined) {
    parts.push(
      `第${value.week_start}${
        value.week_end !== null &&
        value.week_end !== undefined &&
        value.week_end !== value.week_start
          ? `–${value.week_end}`
          : ""
      }周`,
    );
  }
  if (value.classroom) parts.push(value.classroom);
  if (hasTime && value.stage_label) parts.push(value.stage_label);
  const rest = parts.join(" · ");
  return {
    weekday: weekdays[value.weekday - 1] ?? String(value.weekday),
    rest,
  };
}

export function scheduleSummary(value: ScheduleFields): string {
  const parts = summaryParts(value);
  return `${parts.weekday} ${parts.rest}`;
}
