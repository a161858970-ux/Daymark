import type { CourseSchedule } from "@daymark/domain";
import {
  getMessage,
  readStoredLocale,
  weekdayLabels,
  type Locale,
} from "./i18n/index.js";

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

/** Copy needed to render one schedule row; injectable so tests can pin a locale. */
export type ScheduleLabels = {
  /** Index 0 = weekday 1 (Monday) … index 6 = weekday 7 (Sunday). */
  weekdays: readonly string[];
  timePending: string;
  /** `common.weekPrefix` template, e.g. `第{week}周`. */
  weekPrefix: string;
  /** `common.weekRange` template, e.g. `第{from}–{to}周`. */
  weekRange: string;
};

export function scheduleLabelsFor(locale: Locale): ScheduleLabels {
  return {
    weekdays: weekdayLabels(locale),
    timePending: getMessage(locale, "course.timePending"),
    weekPrefix: getMessage(locale, "common.weekPrefix"),
    weekRange: getMessage(locale, "common.weekRange"),
  };
}

function defaultLabels(): ScheduleLabels {
  return scheduleLabelsFor(readStoredLocale());
}

/**
 * One wording for every surface that shows a schedule row: the list, the
 * editing hint and the conflict comparison must read identically.
 */
export function summaryParts(
  value: ScheduleFields,
  labels: ScheduleLabels = defaultLabels(),
): {
  weekday: string;
  rest: string;
} {
  const hasTime = Boolean(value.start_time && value.end_time);
  // Without a stated clock time the period label leads the line; with one,
  // the line is unchanged and the period label stays an extra part.
  const parts: string[] = [
    hasTime
      ? `${value.start_time!.slice(0, 5)}–${value.end_time!.slice(0, 5)}`
      : value.stage_label?.trim() || labels.timePending,
  ];
  if (value.week_start !== null && value.week_start !== undefined) {
    const hasSpan =
      value.week_end !== null &&
      value.week_end !== undefined &&
      value.week_end !== value.week_start;
    parts.push(
      hasSpan
        ? labels.weekRange
            .replace("{from}", String(value.week_start))
            .replace("{to}", String(value.week_end))
        : labels.weekPrefix.replace("{week}", String(value.week_start)),
    );
  }
  if (value.classroom) parts.push(value.classroom);
  if (hasTime && value.stage_label) parts.push(value.stage_label);
  const rest = parts.join(" · ");
  return {
    weekday: labels.weekdays[value.weekday - 1] ?? String(value.weekday),
    rest,
  };
}

export function scheduleSummary(
  value: ScheduleFields,
  labels: ScheduleLabels = defaultLabels(),
): string {
  const parts = summaryParts(value, labels);
  return `${parts.weekday} ${parts.rest}`;
}
