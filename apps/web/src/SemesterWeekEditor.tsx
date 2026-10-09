import { useEffect, useMemo, useState } from "react";
import type { Semester, SemesterWeek } from "@daymark/domain";
import { SelectField } from "./SelectField.js";
import { useI18n, useT } from "./i18n/index.js";
import { toUserMessage } from "./errors.js";
import {
  addDays,
  anchorMatchesCalendar,
  anchorOf,
  applyWeekSelection,
  monthKey,
  naturalWeeksBetween,
  projectedWeekNumber,
  projectedWeeks,
  shortRange,
  type WeekFields,
  type WeekRange,
} from "./semesterWeeks.js";
import {
  loadWeekStart,
  readLocalWeekStart,
  saveWeekStart,
  weekStartLabel,
  weekStartOptionLabels,
} from "./weekStart.js";

export type { WeekFields };

/** The first week may legitimately start before the semester's own date. */
const FIRST_WEEK_SEARCH_BUFFER_WEEKS = 4;

interface Props {
  semester: Semester;
  weeks: SemesterWeek[];
  onReplace(values: WeekFields[]): Promise<void>;
  /** Test seam; production loads the account preference. */
  initialWeekStart?: number;
}

/**
 * Week picking without date typing (product decision 2026-09-28):
 * weeks are Monday-to-Sunday calendar weeks, a row click binds week number
 * and dates, and once the first week exists every later row shows the week
 * number it projects to — clicking one fills all weeks in between.
 */
export function SemesterWeekEditor({
  semester,
  weeks,
  onReplace,
  initialWeekStart,
}: Props) {
  const t = useT();
  const { locale, formatYearMonth } = useI18n();
  const [weekStart, setWeekStart] = useState<number>(
    initialWeekStart ?? readLocalWeekStart(),
  );

  useEffect(() => {
    if (initialWeekStart !== undefined) return;
    let alive = true;
    void loadWeekStart().then((value) => {
      if (alive) setWeekStart(value);
    });
    return () => {
      alive = false;
    };
  }, [initialWeekStart]);
  const existing: WeekFields[] = useMemo(
    () =>
      weeks.map(({ week_number, start_date, end_date }) => ({
        week_number,
        start_date,
        end_date,
      })),
    [weeks],
  );
  const anchor = useMemo(() => anchorOf(existing), [existing]);
  const nextNumber = String(
    Math.max(0, ...existing.map((week) => week.week_number)) + 1 || 1,
  );
  const [weekNumber, setWeekNumber] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  // Four weeks of buffer on each side: some schools start 第1周 before the
  // semester's own start_date, and the picker must reach that week.
  const rows = useMemo(
    () =>
      naturalWeeksBetween(
        addDays(semester.start_date, -FIRST_WEEK_SEARCH_BUFFER_WEEKS * 7),
        addDays(semester.end_date, FIRST_WEEK_SEARCH_BUFFER_WEEKS * 7),
        weekStart,
      ),
    [semester.start_date, semester.end_date, weekStart],
  );
  const grouped = useMemo(() => {
    const byMonth = new Map<string, WeekRange[]>();
    for (const row of rows) {
      const key = monthKey(row);
      byMonth.set(key, [...(byMonth.get(key) ?? []), row]);
    }
    return [...byMonth.entries()];
  }, [rows]);

  function manualNumber(): number {
    const value = Number(weekNumber);
    return Number.isInteger(value) && value >= 1 ? value : Number(nextNumber);
  }

  async function choose(range: WeekRange) {
    const projected = anchor
      ? projectedWeekNumber(anchor, range.start_date, weekStart)
      : null;
    const fill =
      anchor && projected !== null
        ? projectedWeeks(anchor, range.start_date, weekStart)
        : null;
    const selection: WeekFields[] = fill ?? [
      { week_number: manualNumber(), ...range },
    ];
    try {
      await onReplace(applyWeekSelection(existing, selection));
      const first = selection[0]!.week_number;
      const last = selection[selection.length - 1]!.week_number;
      const updates = selection.every((week) =>
        existing.some((value) => value.week_number === week.week_number),
      );
      setStatus(
        selection.length > 1
          ? t("course.weeksFilled", { from: first, to: last })
          : updates
            ? t("course.weekUpdated", { week: first })
            : t("course.weekAdded", { week: first }),
      );
      setError(null);
    } catch (cause) {
      setError(toUserMessage(cause));
      setStatus(null);
    }
  }

  async function remove(id: string) {
    try {
      await onReplace(
        weeks
          .filter((week) => week.id !== id)
          .map(({ week_number, start_date, end_date }) => ({
            week_number,
            start_date,
            end_date,
          })),
      );
      setError(null);
      setStatus(null);
    } catch (cause) {
      setError(toUserMessage(cause));
    }
  }

  return (
    <section
      className="semester-weeks"
      aria-label={t("course.weekSettingsAria", { name: semester.name })}
    >
      <h2>{t("course.weekSettingsTitle", { name: semester.name })}</h2>
      <p className="section-note">{t("course.weekSettingsNote")}</p>
      <ul className="schedule-list">
        {weeks.map((week) => (
          <li key={week.id}>
            <span>
              {t("course.weekRow", {
                week: week.week_number,
                start: week.start_date,
                end: week.end_date,
              })}
            </span>
            <button
              type="button"
              className="quiet-button"
              onClick={() => void remove(week.id)}
            >
              {t("common.remove")}
            </button>
          </li>
        ))}
      </ul>

      <div className="week-start-row">
        <label htmlFor="week-start">{t("course.weekStartDay")}</label>
        <SelectField
          id="week-start"
          ariaLabel={t("course.weekStartDay")}
          label={t("course.weekStartDay")}
          value={String(weekStart)}
          onChange={(next) => {
            const value = Number(next);
            setWeekStart(value);
            void saveWeekStart(value);
            setStatus(
              t("course.weekStartChanged", {
                day: weekStartLabel(value, locale),
              }),
            );
            setError(null);
          }}
          options={weekStartOptionLabels(locale).map((option) => ({
            value: String(option.value),
            label: option.label,
          }))}
        />
      </div>

      {anchor && !anchorMatchesCalendar(anchor, weekStart) && (
        <p className="week-calendar-warning" role="alert">
          {t("course.weekCalendarMismatch", {
            week: anchor.week_number,
            start: anchor.start_date,
            day: weekStartLabel(weekStart, locale),
          })}
        </p>
      )}

      {!anchor && (
        <div className="week-bootstrap" role="note">
          <strong>{t("course.firstWeekTitle")}</strong>
          <p>
            {t("course.firstWeekNote", {
              from: weekStartLabel(1, locale),
              to: weekStartLabel(0, locale),
              week: 1,
            })}
          </p>
        </div>
      )}
      {anchor && (
        <p className="week-anchor-note">
          {t("course.anchorNote", {
            week: anchor.week_number,
            start: anchor.start_date,
          })}
        </p>
      )}

      <div className="week-picker">
        {anchor && (
          <label className="week-picker-control">
            {t("common.weeks")}
            <input
              type="number"
              min="1"
              aria-label={t("course.semesterWeekAria")}
              placeholder={nextNumber}
              value={weekNumber}
              onChange={(event) => setWeekNumber(event.target.value)}
            />
          </label>
        )}

        {grouped.map(([key, list]) => (
          <div key={key} className="week-month">
            <p className="week-month-label">
              {formatYearMonth(
                new Date(
                  Number(key.slice(0, 4)),
                  Number(key.slice(5, 7)) - 1,
                  1,
                ),
              )}
            </p>
            <ul className="week-rows">
              {list.map((range) => {
                const projected = anchor
                  ? projectedWeekNumber(anchor, range.start_date, weekStart)
                  : null;
                // Nothing is known before the first week exists: every row
                // offers itself as 第1周 and no number is inferred.
                const number = anchor ? (projected ?? manualNumber()) : 1;
                const fillSize =
                  anchor && projected !== null
                    ? projected - anchor.week_number + 1
                    : 1;
                return (
                  <li key={range.start_date}>
                    <button
                      type="button"
                      className="week-row"
                      onClick={() => void choose(range)}
                    >
                      <span className="week-row-range">
                        {shortRange(range)}
                      </span>
                      <strong className="week-row-number">
                        {t("common.weekPrefix", { week: number })}
                      </strong>
                      {!anchor ? (
                        <em className="week-row-anchor">
                          {t("course.chooseFirstWeek", { week: 1 })}
                        </em>
                      ) : projected !== null ? (
                        <em className="week-row-projected">
                          {t("course.projectedBadge")}
                        </em>
                      ) : (
                        <em className="week-row-manual">
                          {t("course.manualBadge")}
                        </em>
                      )}
                      {fillSize > 1 && projected !== null && (
                        <small className="week-row-fill">
                          {t("course.fillWeeks", {
                            from: anchor!.week_number,
                            to: projected,
                          })}
                        </small>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      {status && (
        <p className="week-status" role="status">
          {status}
        </p>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
