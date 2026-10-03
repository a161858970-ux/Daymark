import { useState } from "react";
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
export function formatStamp(local: string, forceTime = false): string {
  if (!local) return "";
  const [date = "", time = ""] = local.split("T");
  const [, month = "0", day = "0"] = date.split("-");
  const stamp = `${Number(month)}月${Number(day)}日`;
  return time && (time !== "00:00" || forceTime) ? `${stamp} ${time}` : stamp;
}

/** 发生 is the one semantic that may be a point or a span. */
export function formatOccurrence(start: string, end: string): string {
  if (!start) return "";
  if (!end) return `${formatStamp(start)} 发生`;
  const sameDay = end.slice(0, 10) === start.slice(0, 10);
  const span = sameDay
    ? `${formatStamp(start, true)}–${end.slice(11, 16)}`
    : `${formatStamp(start)}–${formatStamp(end)}`;
  return `${span} 发生`;
}

export interface TimeSummary {
  key: keyof TimeFields;
  text: string;
}

/** Natural-language lines for whichever semantics are actually set. */
export function timeSummaries(value: TimeFields): TimeSummary[] {
  const summaries: TimeSummary[] = [];
  if (value.startAt)
    summaries.push({
      key: "startAt",
      text: `开始于 ${formatStamp(value.startAt)}`,
    });
  if (value.occurrenceStartAt)
    summaries.push({
      key: "occurrenceStartAt",
      text: formatOccurrence(value.occurrenceStartAt, value.occurrenceEndAt),
    });
  if (value.dueAt)
    summaries.push({
      key: "dueAt",
      text: `截止于 ${formatStamp(value.dueAt)}`,
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
  const [open, setOpen] = useState(false);
  const summaries = timeSummaries(value);

  const clearStart = () => onChange({ ...value, startAt: "" });
  const clearOccurrence = () =>
    onChange({ ...value, occurrenceStartAt: "", occurrenceEndAt: "" });
  const clearDue = () => onChange({ ...value, dueAt: "" });

  return (
    <div className="time-block">
      <p className="time-block-head">时间</p>

      {!open && summaries.length === 0 && (
        <button
          type="button"
          className="time-block-empty"
          onClick={() => setOpen(true)}
        >
          时间未定<span>设置时间</span>
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
            调整时间
          </button>
        </>
      )}

      {open && (
        <div className="time-block-editor">
          <label className="time-block-row">
            <span className="time-block-kind">开始</span>
            <DateTimeField
              mode="datetime"
              label="开始时间"
              placeholder="从什么时候开始"
              value={value.startAt}
              onChange={(next) => onChange({ ...value, startAt: next })}
            />
            {value.startAt && (
              <button
                type="button"
                className="quiet-button"
                onClick={clearStart}
              >
                清除
              </button>
            )}
          </label>

          <label className="time-block-row">
            <span className="time-block-kind">发生</span>
            <DateTimeField
              mode="datetime"
              label="发生开始"
              placeholder={
                value.occurrenceStartAt ? "发生开始" : "事情什么时候发生"
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
                label="发生结束"
                placeholder="结束（可选）"
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
                清除
              </button>
            )}
          </label>

          <label className="time-block-row">
            <span className="time-block-kind">截止</span>
            <DateTimeField
              mode="datetime"
              label="截止时间"
              placeholder="最晚什么时候完成"
              value={value.dueAt}
              onChange={(next) => onChange({ ...value, dueAt: next })}
            />
            {value.dueAt && (
              <button type="button" className="quiet-button" onClick={clearDue}>
                清除
              </button>
            )}
          </label>

          <button
            type="button"
            className="quiet-button time-block-done"
            onClick={() => setOpen(false)}
          >
            {summaries.length > 0 ? "完成" : "先不设置"}
          </button>
        </div>
      )}
    </div>
  );
}
