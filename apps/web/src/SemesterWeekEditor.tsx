import { useEffect, useMemo, useState } from "react";
import type { Semester, SemesterWeek } from "@course-manager/domain";
import { toUserMessage } from "./errors.js";
import {
  addDays,
  anchorMatchesCalendar,
  anchorOf,
  applyWeekSelection,
  monthKey,
  monthLabel,
  naturalWeeksBetween,
  projectedWeekNumber,
  projectedWeeks,
  shortRange,
  type WeekFields,
  type WeekRange,
} from "./semesterWeeks.js";
import {
  WEEK_START_OPTIONS,
  loadWeekStart,
  readLocalWeekStart,
  saveWeekStart,
  weekStartLabel,
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
          ? `已补齐第${first}周 – 第${last}周`
          : updates
            ? `已更新第${first}周`
            : `已添加第${first}周`,
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
    <section className="semester-weeks" aria-label={`${semester.name}周次设置`}>
      <h2>{semester.name} · 周次</h2>
      <p className="section-note">
        一周按公历自然周计算，起始日可在下方切换（默认周一）。选择日期行即可绑定周次，
        不需要手动填写起止日期。
      </p>
      <ul className="schedule-list">
        {weeks.map((week) => (
          <li key={week.id}>
            <span>
              第{week.week_number}周 · {week.start_date} 至 {week.end_date}
            </span>
            <button
              type="button"
              className="quiet-button"
              onClick={() => void remove(week.id)}
            >
              移除
            </button>
          </li>
        ))}
      </ul>

      <div className="week-start-row">
        <label htmlFor="week-start">一周起始日</label>
        <select
          id="week-start"
          aria-label="一周起始日"
          value={weekStart}
          onChange={(event) => {
            const value = Number(event.target.value);
            setWeekStart(value);
            void saveWeekStart(value);
            setStatus(
              `已将一周起始日设为${weekStartLabel(value)}；已存在的周次日期不会自动改变。`,
            );
            setError(null);
          }}
        >
          {WEEK_START_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {anchor && !anchorMatchesCalendar(anchor, weekStart) && (
        <p className="week-calendar-warning" role="alert">
          已选的第{anchor.week_number}周从 {anchor.start_date} 开始， 与当前「
          {weekStartLabel(weekStart)}起始」的日历不一致，因此推算已暂停。
          如需按新起始日推算，请移除现有周次后重新选择第一周。
        </p>
      )}

      {!anchor && (
        <div className="week-bootstrap" role="note">
          <strong>先确定第一周</strong>
          <p>
            这个学期还没有周次。第一周从哪一天开始只有你知道 —— 请点击下方对应的
            那一周（周一至周日）把它选为第 1
            周；选定之后才会出现后续周次的自动推算。
          </p>
        </div>
      )}
      {anchor && (
        <p className="week-anchor-note">
          已确定第{anchor.week_number}周为 {anchor.start_date}{" "}
          起的一周；下方每行都标出推算周次， 点选可自动补齐中间缺少的周。
        </p>
      )}

      <div className="week-picker">
        {anchor && (
          <label className="week-picker-control">
            周次
            <input
              type="number"
              min="1"
              aria-label="学期周次"
              placeholder={nextNumber}
              value={weekNumber}
              onChange={(event) => setWeekNumber(event.target.value)}
            />
          </label>
        )}

        {grouped.map(([key, list]) => (
          <div key={key} className="week-month">
            <p className="week-month-label">{monthLabel(key)}</p>
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
                      <strong className="week-row-number">第{number}周</strong>
                      {!anchor ? (
                        <em className="week-row-anchor">选为第1周</em>
                      ) : projected !== null ? (
                        <em className="week-row-projected">推算</em>
                      ) : (
                        <em className="week-row-manual">按左侧周次</em>
                      )}
                      {fillSize > 1 && (
                        <small className="week-row-fill">
                          点选补齐第{anchor!.week_number}–第{projected}周
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
