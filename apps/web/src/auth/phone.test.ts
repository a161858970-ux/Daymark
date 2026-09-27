import { expect, it } from "vitest";
import { normalizePhone, formatPhoneDisplay, phoneCountryOf } from "./phone.js";

it("normalizes local Chinese input to E.164 with the default +86 country", () => {
  expect(normalizePhone("13800001111")).toBe("+8613800001111");
  expect(normalizePhone("138 0000 1111")).toBe("+8613800001111");
  expect(normalizePhone("138-0000-1111")).toBe("+8613800001111");
});

it("keeps international numbers and never hardcodes a China-only model", () => {
  expect(normalizePhone("+1 415 555 2671", "+86")).toBe("+14155552671");
  expect(normalizePhone("4155552671", "+1")).toBe("+14155552671");
  expect(normalizePhone("+886912345678", "+86")).toBe("+886912345678");
  expect(phoneCountryOf("+441234567890")?.iso).toBe("GB");
  expect(phoneCountryOf("+886912345678")?.iso).toBe("TW");
});

it("rejects values that cannot be E.164", () => {
  expect(normalizePhone("")).toBeNull();
  expect(normalizePhone("abc")).toBeNull();
  expect(normalizePhone("123")).toBeNull();
  expect(normalizePhone("+0123456789")).toBeNull();
  expect(normalizePhone("+1234567890123456789")).toBeNull();
});

it("formats a display grouping without changing the stored value", () => {
  expect(formatPhoneDisplay("+8613800001111")).toBe("+86 138 0000 1111");
  expect(formatPhoneDisplay("+14155552671")).toBe("+1 415 555 267 1");
});
