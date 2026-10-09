/**
 * Phone identity helpers.
 *
 * Phone numbers are always normalized to E.164 before they reach Supabase
 * Auth. The country code is a UI concern (default +86 for the primary
 * audience) and never a data-model concern: any international number that
 * fits E.164 remains representable.
 *
 * Region labels are message keys under `auth.region.*`; resolve them with
 * `phoneCountryLabel` at display time. The number itself is data — never
 * translated.
 */

import { getMessage } from "../i18n/messages/index.js";
import { readStoredLocale } from "../i18n/locale.js";

export interface PhoneCountry {
  readonly code: string;
  readonly iso: string;
  /** Catalog key under `auth.region.*`. */
  readonly labelKey: string;
}

/** Selectable country codes; not an exhaustive world list, just the UI menu. */
export const PHONE_COUNTRIES: readonly PhoneCountry[] = [
  { code: "+86", iso: "CN", labelKey: "auth.region.cn" },
  { code: "+852", iso: "HK", labelKey: "auth.region.hk" },
  { code: "+853", iso: "MO", labelKey: "auth.region.mo" },
  { code: "+886", iso: "TW", labelKey: "auth.region.tw" },
  { code: "+1", iso: "US", labelKey: "auth.region.usca" },
  { code: "+81", iso: "JP", labelKey: "auth.region.jp" },
  { code: "+82", iso: "KR", labelKey: "auth.region.kr" },
  { code: "+65", iso: "SG", labelKey: "auth.region.sg" },
  { code: "+44", iso: "GB", labelKey: "auth.region.gb" },
  { code: "+61", iso: "AU", labelKey: "auth.region.au" },
];

export const DEFAULT_PHONE_COUNTRY = "+86";

/** Localized region name for a country entry. */
export function phoneCountryLabel(country: PhoneCountry): string {
  return getMessage(readStoredLocale(), country.labelKey);
}

/**
 * Normalize a typed number to E.164, or null when it cannot be one.
 * An explicit leading "+" always wins over the selected country code.
 */
export function normalizePhone(
  raw: string,
  countryCode: string = DEFAULT_PHONE_COUNTRY,
): string | null {
  const compact = raw.replace(/[\s()\-.]/g, "");
  if (!compact) return null;
  const candidate = compact.startsWith("+")
    ? compact
    : `${countryCode}${compact.replace(/^0+/, "")}`;
  return /^\+[1-9]\d{6,14}$/.test(candidate) ? candidate : null;
}

/** Longest-prefix country match for a normalized number. */
export function phoneCountryOf(e164: string): PhoneCountry | null {
  const ordered = [...PHONE_COUNTRIES].sort(
    (a, b) => b.code.length - a.code.length,
  );
  return ordered.find((country) => e164.startsWith(country.code)) ?? null;
}

/** Human readable grouping for display only; storage keeps E.164. */
export function formatPhoneDisplay(e164: string): string {
  const country = phoneCountryOf(e164);
  if (!country) return e164;
  const rest = e164.slice(country.code.length);
  const groups =
    country.iso === "CN" && rest.length === 11
      ? [rest.slice(0, 3), rest.slice(3, 7), rest.slice(7)]
      : (rest.match(/.{1,3}/g) ?? [rest]);
  return `${country.code} ${groups.join(" ")}`;
}
