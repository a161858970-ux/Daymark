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

  const value = useMemo<I18nValue>(() => {
    const t: Translate = (key, params) => getMessage(locale, key, params);
    return {
      locale,
      setLocale,
      t,
      formatTime: (value, options) => fmt.formatTime(value, locale, options),
      formatDateTime: (value, options) =>
        fmt.formatDateTime(value, locale, options),
      formatDateOnly: (value) => fmt.formatDateOnly(value, locale),
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
  }, [locale, setLocale]);

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
