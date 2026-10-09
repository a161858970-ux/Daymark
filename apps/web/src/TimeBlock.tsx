import { useState } from "react";
import { useI18n } from "./i18n/index.js";
import { formatMonthDay } from "./i18n/format.js";
import { getMessage } from "./i18n/messages/index.js";
import type { Locale } from "./i18n/locale.js";
import { DateTimeField } from "./DateTimeField.js";

/** The four underlying fields, unchanged — presentation only. */
export interface TimeFields {
  startAt: string;
  occurrenceStartAt: string;
  occurrenceEndAt: string;
  dueAt: string;
}

interface Props {
  value: TimeFields;
  onChange: (next: TimeFields) => void;
}

/** "2026-09-20T00:00" → "9月20日"; midnight reads as a date only. */
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

/** 发生 is the one semantic that may be a point or a span. */
export function formatOccurrence(
  start: string,
  end: string,
  locale: Locale,
): string {
  if (!start) return "";
  if (!end)
    return getMessage(locale, "item.occurAt", {
      value: formatStamp(start, locale),
    });
  const sameDay = end.slice(0, 10) === start.slice(0, 10);
  const span = sameDay
    ? `${formatStamp(start, locale, true)}–${end.slice(11, 16)}`
    : `${formatStamp(start, locale)}–${formatStamp(end, locale)}`;
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
  if (value.startAt)
    summaries.push({
      key: "startAt",
      text: getMessage(locale, "item.startAt", {
        value: formatStamp(value.startAt, locale),
      }),
    });
  if (value.occurrenceStartAt)
    summaries.push({
      key: "occurrenceStartAt",
      text: formatOccurrence(
        value.occurrenceStartAt,
        value.occurrenceEndAt,
        locale,
      ),
    });
  if (value.dueAt)
    summaries.push({
      key: "dueAt",
      text: getMessage(locale, "item.dueAt", {
        value: formatStamp(value.dueAt, locale),
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

  const clearStart = () => onChange({ ...value, startAt: "" });
  const clearOccurrence = () =>
    onChange({ ...value, occurrenceStartAt: "", occurrenceEndAt: "" });
  const clearDue = () => onChange({ ...value, dueAt: "" });

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
              mode="datetime"
              label={t("item.startTimeField")}
              placeholder={t("item.startHint")}
              value={value.startAt}
              onChange={(next) => onChange({ ...value, startAt: next })}
            />
            {value.startAt && (
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
              mode="datetime"
              label={t("item.occurStartField")}
              placeholder={
                value.occurrenceStartAt
                  ? t("item.occurStartField")
                  : t("item.occurHint")
              }
              value={value.occurrenceStartAt}
              onChange={(next) =>
                onChange({
                  ...value,
                  occurrenceStartAt: next,
                  occurrenceEndAt: next ? value.occurrenceEndAt : "",
                })
              }
            />
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
            {value.occurrenceStartAt && (
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
              mode="datetime"
              label={t("item.dueTimeField")}
              placeholder={t("item.dueHint")}
              value={value.dueAt}
              onChange={(next) => onChange({ ...value, dueAt: next })}
            />
            {value.dueAt && (
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
