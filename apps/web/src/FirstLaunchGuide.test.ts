import { describe, expect, it } from "vitest";
import {
  PERMISSION_GUIDE_KEY,
  shouldShowPermissionGuide,
} from "./FirstLaunchGuide.js";

describe("first-launch permission guide gate", () => {
  it("shows on Android before the flag exists", () => {
    expect(shouldShowPermissionGuide(true, false)).toBe(true);
  });

  it("never shows again once the flag exists", () => {
    expect(shouldShowPermissionGuide(true, true)).toBe(false);
  });

  it("never shows on desktop shells", () => {
    expect(shouldShowPermissionGuide(false, false)).toBe(false);
  });

  it("uses a namespaced storage key", () => {
    expect(PERMISSION_GUIDE_KEY).toBe("daymark.permission-guide.shown");
  });
});
