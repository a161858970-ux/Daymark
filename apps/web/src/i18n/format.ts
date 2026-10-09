import type { Locale } from "./locale.js";
import { bcp47 } from "./locale.js";

/**
 * Display formatting only. Never changes stored timestamps, due dates,
 * semester weeks, reminder times, or week-start business rules.
 */
export function formatTime(
  value: Date | string | number,
  locale: Locale,
  options: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" },
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(bcp47(locale), options).format(date);
}

export function formatDateTime(
  value: Date | string | number,
  locale: Locale,
  options: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  },
): string {
  return formatTime(value, locale, options);
}

export function formatMonthDay(
  value: Date | string | number,
  locale: Locale,
): string {
  return formatTime(value, locale, { month: "long", day: "numeric" });
}

/**
 * Format a DATE calendar body (`YYYY-MM-DD`) as a localized date.
 * Never constructs a UTC-midnight instant for local-timezone conversion —
 * the day body is already the user's calendar day (ADR-010 / spec 22).
 */
export function formatDateOnly(value: string, locale: Locale): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return "";
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(bcp47(locale), {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function formatWeekday(
  value: Date | string | number,
  locale: Locale,
  options: Intl.DateTimeFormatOptions = { weekday: "short" },
): string {
  return formatTime(value, locale, options);
}

export function formatYearMonth(
  value: Date | string | number,
  locale: Locale,
): string {
  return formatTime(value, locale, { year: "numeric", month: "long" });
}

/** `2026-10-09` → localized medium date for headings. */
export function formatDayLabel(
  value: Date | string | number,
  locale: Locale,
): string {
  return formatTime(value, locale, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * Weekday abbreviations for calendar headers / pickers.
 * Monday-first order matches the product week-start default (business rule
 * stays separate — only labels change with language).
 */
export function weekdayLabels(
  locale: Locale,
  style: "short" | "narrow" = "short",
): string[] {
  // 2024-01-01 was a Monday.
  const monday = new Date(Date.UTC(2024, 0, 1));
  const fmt = new Intl.DateTimeFormat(bcp47(locale), {
    weekday: style,
    timeZone: "UTC",
  });
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(monday);
    day.setUTCDate(monday.getUTCDate() + i);
    return fmt.format(day);
  });
}

/** Sunday-first weekday labels (date pickers that start on Sunday). */
export function weekdayLabelsSundayFirst(
  locale: Locale,
  style: "short" | "narrow" = "short",
): string[] {
  const labels = weekdayLabels(locale, style);
  return [labels[6]!, ...labels.slice(0, 6)];
}

export function monthLabel(monthIndex: number, locale: Locale): string {
  const date = new Date(Date.UTC(2024, monthIndex, 1));
  return new Intl.DateTimeFormat(bcp47(locale), {
    month: "long",
    timeZone: "UTC",
  }).format(date);
}
