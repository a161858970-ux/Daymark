import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  bcp47,
  readStoredLocale,
  writeStoredLocale,
  type Locale,
} from "./locale.js";
import {
  getMessage,
  type MessageKey,
  type MessageParams,
} from "./messages/index.js";
import * as fmt from "./format.js";

export type Translate = (
  key: MessageKey | string,
  params?: MessageParams,
) => string;

type I18nValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translate;
  /**
   * Tracked display clock: refreshes at the local New Year rollover and on
   * window focus / visibility restore, so mounted UIs follow the frozen
   * year-display rule without polling.
   */
  now: Date;
  formatTime: (
    value: Date | string | number,
    options?: Intl.DateTimeFormatOptions,
  ) => string;
  formatDateTime: (
    value: Date | string | number,
    options?: Intl.DateTimeFormatOptions,
  ) => string;
  /** DATE calendar body (YYYY-MM-DD) — no timezone shift, no fake clock. */
  formatDateOnly: (value: string) => string;
  /**
   * Compact list labels (frozen year rule: show year only when the item's
   * displayed local year differs from the current local year). `now` is
   * injectable for deterministic tests.
   */
  formatItemDateOnly: (value: string, now?: Date) => string;
  formatItemDateTime: (value: Date | string | number, now?: Date) => string;
  formatMonthDay: (value: Date | string | number) => string;
  formatWeekday: (
    value: Date | string | number,
    options?: Intl.DateTimeFormatOptions,
  ) => string;
  formatYearMonth: (value: Date | string | number) => string;
  formatDayLabel: (value: Date | string | number) => string;
  weekdayLabels: (style?: "short" | "narrow") => string[];
  weekdayLabelsSundayFirst: (style?: "short" | "narrow") => string[];
  monthLabel: (monthIndex: number) => string;
};

const I18nContext = createContext<I18nValue | null>(null);

const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/**
 * A `Date` that stays correct across the local New Year while mounted. One
 * one-shot timer (chained at most every ~24.8 days — never per-second
 * polling) fires at the next local year rollover to trigger a single UI
 * refresh; window focus / visibility restore recalibrate immediately. The
 * year comparison stays on the device's local calendar (no UTC, no UTC+8).
 */
function useDisplayNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const current = new Date();
      const nextYear = new Date(current.getFullYear() + 1, 0, 1);
      const delay = Math.min(
        Math.max(nextYear.getTime() - current.getTime(), 0),
        MAX_TIMEOUT_MS,
      );
      timer = setTimeout(() => {
        setNow(new Date());
        schedule();
      }, delay);
    };
    const calibrate = () => setNow(new Date());
    schedule();
    window.addEventListener("focus", calibrate);
    document.addEventListener("visibilitychange", calibrate);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", calibrate);
      document.removeEventListener("visibilitychange", calibrate);
    };
  }, []);
  return now;
}

function applyDocumentLocale(locale: Locale) {
  if (typeof document === "undefined") return;
  document.documentElement.lang = bcp47(locale);
  document.title = getMessage(locale, "common.brandName");
}

export function I18nProvider({
  children,
  initialLocale,
}: {
  children: ReactNode;
  initialLocale?: Locale;
}) {
  const [locale, setLocaleState] = useState<Locale>(
    () => initialLocale ?? readStoredLocale(),
  );

  useEffect(() => {
    applyDocumentLocale(locale);
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    writeStoredLocale(next);
    setLocaleState(next);
  }, []);

  const now = useDisplayNow();
  const value = useMemo<I18nValue>(() => {
    const t: Translate = (key, params) => getMessage(locale, key, params);
    return {
      locale,
      setLocale,
      t,
      now,
      formatTime: (value, options) => fmt.formatTime(value, locale, options),
      formatDateTime: (value, options) =>
        fmt.formatDateTime(value, locale, options),
      formatDateOnly: (value) => fmt.formatDateOnly(value, locale),
      formatItemDateOnly: (value, nowOverride) =>
        fmt.formatItemDateOnly(value, locale, nowOverride ?? now),
      formatItemDateTime: (value, nowOverride) =>
        fmt.formatItemDateTime(value, locale, nowOverride ?? now),
      formatMonthDay: (value) => fmt.formatMonthDay(value, locale),
      formatWeekday: (value, options) =>
        fmt.formatWeekday(value, locale, options),
      formatYearMonth: (value) => fmt.formatYearMonth(value, locale),
      formatDayLabel: (value) => fmt.formatDayLabel(value, locale),
      weekdayLabels: (style) => fmt.weekdayLabels(locale, style),
      weekdayLabelsSundayFirst: (style) =>
        fmt.weekdayLabelsSundayFirst(locale, style),
      monthLabel: (monthIndex) => fmt.monthLabel(monthIndex, locale),
    };
  }, [locale, setLocale, now]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) {
    throw new Error("useI18n must be used inside I18nProvider");
  }
  return value;
}

/** Shorthand for components that only need the translate function. */
export function useT(): Translate {
  return useI18n().t;
}
