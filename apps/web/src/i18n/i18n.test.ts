import { describe, expect, it } from "vitest";
import {
  catalogParityIssues,
  getMessage,
  interpolate,
} from "./messages/index.js";
import {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_LABELS,
  readStoredLocale,
  writeStoredLocale,
} from "./locale.js";
import {
  formatDateTime,
  formatYearMonth,
  weekdayLabels,
  weekdayLabelsSundayFirst,
} from "./format.js";

describe("i18n message catalogs", () => {
  it("keeps zh-CN and en-US keys in lockstep", () => {
    expect(catalogParityIssues()).toEqual([]);
  });

  it("interpolates named parameters without concatenating fragments", () => {
    expect(interpolate("Week {week}", { week: 3 })).toBe("Week 3");
    expect(interpolate("第{week}周", { week: 3 })).toBe("第3周");
    expect(interpolate("Hello {name}", {})).toBe("Hello {name}");
  });

  it("returns product copy for both locales", () => {
    expect(getMessage("zh-CN", "nav.overview")).toBe("事项总览");
    expect(getMessage("en-US", "nav.overview")).toBe("Tasks");
    expect(getMessage("en-US", "common.brandName")).toBe("拾序");
  });
});

describe("locale preference", () => {
  function installFakeStorage() {
    const store = new Map<string, string>();
    Object.assign(globalThis, {
      window: {
        localStorage: {
          getItem: (key: string) => store.get(key) ?? null,
          setItem: (key: string, value: string) => {
            store.set(key, value);
          },
          removeItem: (key: string) => {
            store.delete(key);
          },
        },
      },
    });
    return store;
  }

  it("defaults to zh-CN when nothing is stored", () => {
    installFakeStorage();
    expect(readStoredLocale()).toBe(DEFAULT_LOCALE);
  });

  it("round-trips a user choice and accepts only supported locales", () => {
    const store = installFakeStorage();
    writeStoredLocale("en-US");
    expect(readStoredLocale()).toBe("en-US");
    writeStoredLocale("zh-CN");
    expect(readStoredLocale()).toBe("zh-CN");
    store.set("cm.app_locale", "fr-FR");
    expect(readStoredLocale()).toBe(DEFAULT_LOCALE);
  });

  it("labels options with their native names", () => {
    expect(LOCALE_LABELS["zh-CN"]).toBe("简体中文");
    expect(LOCALE_LABELS["en-US"]).toBe("English");
    expect(LOCALES).toEqual(["zh-CN", "en-US"]);
  });
});

describe("locale-aware formatting", () => {
  const sample = new Date(Date.UTC(2026, 9, 9, 4, 5));

  it("formats year-month per locale", () => {
    expect(formatYearMonth(sample, "zh-CN")).toContain("2026");
    expect(formatYearMonth(sample, "en-US")).toMatch(/2026/);
  });

  it("formats date-time without throwing", () => {
    expect(formatDateTime(sample, "zh-CN").length).toBeGreaterThan(0);
    expect(formatDateTime(sample, "en-US").length).toBeGreaterThan(0);
  });

  it("exposes Monday-first week labels and a Sunday-first variant", () => {
    const zh = weekdayLabels("zh-CN");
    const en = weekdayLabels("en-US");
    expect(zh).toHaveLength(7);
    expect(en).toHaveLength(7);
    expect(weekdayLabelsSundayFirst("en-US")[0]).toBe(en[6]);
  });
});
