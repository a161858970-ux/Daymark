import { accountEn, accountZh } from "./account.js";
import { appEn, appZh } from "./app.js";
import { authEn, authZh } from "./auth.js";
import {
  calendarEn,
  calendarZh,
  captureEn,
  captureZh,
  searchEn,
  searchZh,
} from "./calendar.js";
import { commonEn, commonZh } from "./common.js";
import { conflictEn, conflictZh } from "./conflict.js";
import { courseEn, courseZh } from "./course.js";
import { errorsEn, errorsZh } from "./errors.js";
import { itemEn, itemZh } from "./item.js";
import { navEn, navZh } from "./nav.js";
import { syncEn, syncZh } from "./sync.js";
import {
  flattenMessages,
  interpolate,
  type MessageParams,
  type MessageTree,
} from "./types.js";
import type { Locale } from "../locale.js";

/**
 * Domain catalogs. Each domain owns a leaf under its namespace so parallel
 * conversions can add keys without fighting over one giant file.
 * Add a new domain only here + a matching pair of exports.
 */
const catalogs: Record<Locale, MessageTree> = {
  "zh-CN": {
    common: commonZh,
    nav: navZh,
    errors: errorsZh,
    app: appZh,
    item: itemZh,
    course: courseZh,
    calendar: calendarZh,
    search: searchZh,
    capture: captureZh,
    account: accountZh,
    auth: authZh,
    conflict: conflictZh,
    sync: syncZh,
  },
  "en-US": {
    common: commonEn,
    nav: navEn,
    errors: errorsEn,
    app: appEn,
    item: itemEn,
    course: courseEn,
    calendar: calendarEn,
    search: searchEn,
    capture: captureEn,
    account: accountEn,
    auth: authEn,
    conflict: conflictEn,
    sync: syncEn,
  },
};

const flat: Record<Locale, Record<string, string>> = {
  "zh-CN": flattenMessages(catalogs["zh-CN"]),
  "en-US": flattenMessages(catalogs["en-US"]),
};

export type MessageKey = keyof (typeof flat)["zh-CN"] & string;

export function allMessageKeys(locale: Locale): string[] {
  return Object.keys(flat[locale]).sort();
}

export function getMessage(
  locale: Locale,
  key: string,
  params?: MessageParams,
): string {
  const template = flat[locale][key];
  if (template === undefined) {
    if (import.meta.env?.DEV) {
      console.warn(`[i18n] missing key ${key} for ${locale}`);
    }
    return key;
  }
  return interpolate(template, params);
}

/** Structural parity check used by unit tests. */
export function catalogParityIssues(): string[] {
  const zh = new Set(allMessageKeys("zh-CN"));
  const en = new Set(allMessageKeys("en-US"));
  const issues: string[] = [];
  for (const key of zh) if (!en.has(key)) issues.push(`missing en-US: ${key}`);
  for (const key of en) if (!zh.has(key)) issues.push(`missing zh-CN: ${key}`);
  return issues.sort();
}

export { flattenMessages, interpolate };
export type { MessageParams, MessageTree };
