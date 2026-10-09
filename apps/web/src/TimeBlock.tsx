import { useState } from "react";
import { useI18n } from "./i18n/index.js";
import { formatMonthDay } from "./i18n/format.js";
import { getMessage } from "./i18n/messages/index.js";
import type { Locale } from "./i18n/locale.js";
import { DateTimeField } from "./DateTimeField.js";

/**
 * Time editing surface. Each semantic is DATE (`*Date`) or DATETIME (`*At`),
 * never both (ADR-010). Empty string means unset.
 */
export interface TimeFields {
  startAt: string;
  startDate: string;
  occurrenceStartAt: string;
  occurrenceStartDate: string;
  occurrenceEndAt: string;
  occurrenceEndDate: string;
  dueAt: string;
  dueDate: string;
}

interface Props {
  value: TimeFields;
  onChange: (next: TimeFields) => void;
}

/** "2026-09-20" → "9月20日"; "2026-09-20T15:00" keeps the clock. */
export function formatStamp(
  local: string,
  locale: Locale,
  forceTime = false,
): string {
  if (!local) return "";
  const [date = "", time = ""] = local.split("T");
  const [year = 0, month = 0, day = 0] = date.split("-").map(Number);
  if (!year || !month || !day) return "";
  const stamp = formatMonthDay(new Date(year, month - 1, day), locale);
  return time && (time !== "00:00" || forceTime) ? `${stamp} ${time}` : stamp;
}

export function formatOccurrence(
  startDate: string,
  startAt: string,
  endDate: string,
  endAt: string,
  locale: Locale,
): string {
  if (!startDate && !startAt) return "";
  if (startDate) {
    const span =
      endDate && endDate !== startDate
        ? `${formatStamp(startDate, locale)}–${formatStamp(endDate, locale)}`
        : formatStamp(startDate, locale);
    return getMessage(locale, "item.occurAt", { value: span });
  }
  if (!endAt)
    return getMessage(locale, "item.occurAt", {
      value: formatStamp(startAt, locale),
    });
  const sameDay = endAt.slice(0, 10) === startAt.slice(0, 10);
  const span = sameDay
    ? `${formatStamp(startAt, locale, true)}–${endAt.slice(11, 16)}`
    : `${formatStamp(startAt, locale)}–${formatStamp(endAt, locale)}`;
  return getMessage(locale, "item.occurAt", { value: span });
}

export interface TimeSummary {
  key: keyof TimeFields;
  text: string;
}

/** Natural-language lines for whichever semantics are actually set. */
export function timeSummaries(
  value: TimeFields,
  locale: Locale,
): TimeSummary[] {
  const summaries: TimeSummary[] = [];
  if (value.startAt || value.startDate)
    summaries.push({
      key: value.startDate ? "startDate" : "startAt",
      text: getMessage(locale, "item.startAt", {
        value: formatStamp(value.startDate || value.startAt, locale),
      }),
    });
  if (value.occurrenceStartAt || value.occurrenceStartDate)
    summaries.push({
      key: value.occurrenceStartDate
        ? "occurrenceStartDate"
        : "occurrenceStartAt",
      text: formatOccurrence(
        value.occurrenceStartDate,
        value.occurrenceStartAt,
        value.occurrenceEndDate,
        value.occurrenceEndAt,
        locale,
      ),
    });
  if (value.dueAt || value.dueDate)
    summaries.push({
      key: value.dueDate ? "dueDate" : "dueAt",
      text: getMessage(locale, "item.dueAt", {
        value: formatStamp(value.dueDate || value.dueAt, locale),
      }),
    });
  return summaries;
}

/**
 * One "时间" block in place of the four raw datetime fields.
 *
 * Users think in three semantics — 开始 / 发生 / 截止 — not in database
 * columns, so the collapsed state reads as prose (`时间未定`, or the lines
 * that are set) and the editor exposes one row per semantic. The values
 * underneath stay exactly `start_at` / `occurrence_start_at` /
 * `occurrence_end_at` / `due_at`; nothing else changes, and every field
 * stays optional.
 */
export function TimeBlock({ value, onChange }: Props) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const summaries = timeSummaries(value, locale);

  const clearStart = () => onChange({ ...value, startAt: "", startDate: "" });
  const clearOccurrence = () =>
    onChange({
      ...value,
      occurrenceStartAt: "",
      occurrenceStartDate: "",
      occurrenceEndAt: "",
      occurrenceEndDate: "",
    });
  const clearDue = () => onChange({ ...value, dueAt: "", dueDate: "" });

  return (
    <div className="time-block">
      <p className="time-block-head">{t("item.timeLabel")}</p>

      {!open && summaries.length === 0 && (
        <button
          type="button"
          className="time-block-empty"
          onClick={() => setOpen(true)}
        >
          {t("item.timeUnset")}
          <span>{t("item.setTime")}</span>
        </button>
      )}

      {!open && summaries.length > 0 && (
        <>
          <ul className="time-block-summary">
            {summaries.map((entry) => (
              <li key={entry.key}>{entry.text}</li>
            ))}
          </ul>
          <button
            type="button"
            className="quiet-button time-block-edit"
            onClick={() => setOpen(true)}
          >
            {t("item.adjustTime")}
          </button>
        </>
      )}

      {open && (
        <div className="time-block-editor">
          <label className="time-block-row">
            <span className="time-block-kind">{t("item.start")}</span>
            <DateTimeField
              mode="date"
              label={t("item.startTimeField")}
              placeholder={t("item.startHint")}
              value={value.startDate}
              onChange={(next) =>
                onChange({
                  ...value,
                  startDate: next,
                  startAt: next ? "" : value.startAt,
                })
              }
            />
            <DateTimeField
              mode="datetime"
              label={t("item.startTimeField")}
              placeholder={t("item.startHint")}
              value={value.startAt}
              onChange={(next) =>
                onChange({
                  ...value,
                  startAt: next,
                  startDate: next ? "" : value.startDate,
                })
              }
            />
            {(value.startAt || value.startDate) && (
              <button
                type="button"
                className="quiet-button"
                onClick={clearStart}
              >
                {t("common.clear")}
              </button>
            )}
          </label>

          <label className="time-block-row">
            <span className="time-block-kind">{t("item.occur")}</span>
            <DateTimeField
              mode="date"
              label={t("item.occurStartField")}
              placeholder={t("item.occurHint")}
              value={value.occurrenceStartDate}
              onChange={(next) =>
                onChange({
                  ...value,
                  occurrenceStartDate: next,
                  occurrenceStartAt: next ? "" : value.occurrenceStartAt,
                  occurrenceEndDate: next ? value.occurrenceEndDate : "",
                  occurrenceEndAt: next ? "" : value.occurrenceEndAt,
                })
              }
            />
            <DateTimeField
              mode="datetime"
              label={t("item.occurStartField")}
              placeholder={t("item.occurHint")}
              value={value.occurrenceStartAt}
              onChange={(next) =>
                onChange({
                  ...value,
                  occurrenceStartAt: next,
                  occurrenceStartDate: next ? "" : value.occurrenceStartDate,
                  occurrenceEndAt: next ? value.occurrenceEndAt : "",
                  occurrenceEndDate: next ? "" : value.occurrenceEndDate,
                })
              }
            />
            {value.occurrenceStartDate && (
              <DateTimeField
                mode="date"
                label={t("item.occurEnd")}
                placeholder={t("item.occurEndLabel")}
                value={value.occurrenceEndDate}
                onChange={(next) =>
                  onChange({ ...value, occurrenceEndDate: next })
                }
              />
            )}
            {value.occurrenceStartAt && (
              <DateTimeField
                mode="datetime"
                label={t("item.occurEnd")}
                placeholder={t("item.occurEndLabel")}
                value={value.occurrenceEndAt}
                onChange={(next) =>
                  onChange({ ...value, occurrenceEndAt: next })
                }
              />
            )}
            {(value.occurrenceStartAt || value.occurrenceStartDate) && (
              <button
                type="button"
                className="quiet-button"
                onClick={clearOccurrence}
              >
                {t("common.clear")}
              </button>
            )}
          </label>

          <label className="time-block-row">
            <span className="time-block-kind">{t("item.due")}</span>
            <DateTimeField
              mode="date"
              label={t("item.dueTimeField")}
              placeholder={t("item.dueHint")}
              value={value.dueDate}
              onChange={(next) =>
                onChange({
                  ...value,
                  dueDate: next,
                  dueAt: next ? "" : value.dueAt,
                })
              }
            />
            <DateTimeField
              mode="datetime"
              label={t("item.dueTimeField")}
              placeholder={t("item.dueHint")}
              value={value.dueAt}
              onChange={(next) =>
                onChange({
                  ...value,
                  dueAt: next,
                  dueDate: next ? "" : value.dueDate,
                })
              }
            />
            {(value.dueAt || value.dueDate) && (
              <button type="button" className="quiet-button" onClick={clearDue}>
                {t("common.clear")}
              </button>
            )}
          </label>

          <button
            type="button"
            className="quiet-button time-block-done"
            onClick={() => setOpen(false)}
          >
            {summaries.length > 0 ? t("item.finishTime") : t("item.skipTime")}
          </button>
        </div>
      )}
    </div>
  );
}
