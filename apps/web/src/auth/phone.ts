/**
 * Phone identity helpers.
 *
 * Phone numbers are always normalized to E.164 before they reach Supabase
 * Auth. The country code is a UI concern (default +86 for the primary
 * audience) and never a data-model concern: any international number that
 * fits E.164 remains representable.
 */

export interface PhoneCountry {
  readonly code: string;
  readonly iso: string;
  readonly label: string;
}

/** Selectable country codes; not an exhaustive world list, just the UI menu. */
export const PHONE_COUNTRIES: readonly PhoneCountry[] = [
  { code: "+86", iso: "CN", label: "中国大陆" },
  { code: "+852", iso: "HK", label: "中国香港" },
  { code: "+853", iso: "MO", label: "中国澳门" },
  { code: "+886", iso: "TW", label: "中国台湾" },
  { code: "+1", iso: "US", label: "美国 / 加拿大" },
  { code: "+81", iso: "JP", label: "日本" },
  { code: "+82", iso: "KR", label: "韩国" },
  { code: "+65", iso: "SG", label: "新加坡" },
  { code: "+44", iso: "GB", label: "英国" },
  { code: "+61", iso: "AU", label: "澳大利亚" },
];

export const DEFAULT_PHONE_COUNTRY = "+86";

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
