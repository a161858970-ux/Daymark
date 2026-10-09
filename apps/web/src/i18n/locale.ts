/** Supported UI locales. Product decision: only these two; default zh-CN. */
export type Locale = "zh-CN" | "en-US";

export const LOCALES: readonly Locale[] = ["zh-CN", "en-US"] as const;

/** Native names stay fixed so either UI language can identify the option. */
export const LOCALE_LABELS: Record<Locale, string> = {
  "zh-CN": "简体中文",
  "en-US": "English",
};

export const DEFAULT_LOCALE: Locale = "zh-CN";

const STORAGE_KEY = "cm.app_locale";

function normalize(value: unknown): Locale | null {
  return value === "zh-CN" || value === "en-US" ? value : null;
}

/** Local UI preference only — never synced, never touches business data. */
export function readStoredLocale(): Locale {
  try {
    const stored = normalize(window.localStorage.getItem(STORAGE_KEY));
    if (stored) return stored;
  } catch {
    /* no storage available */
  }
  return DEFAULT_LOCALE;
}

export function writeStoredLocale(locale: Locale): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    /* no storage available */
  }
}

/** BCP 47 tag used by Intl and document.documentElement.lang. */
export function bcp47(locale: Locale): string {
  return locale;
}
