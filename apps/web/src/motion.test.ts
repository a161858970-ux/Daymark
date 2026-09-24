import { describe, expect, it } from "vitest";
import { effectiveMotionDuration, motionDuration } from "./motion.js";

describe("motion timing", () => {
  it("uses the specification timing baseline", () => {
    expect(motionDuration).toMatchObject({
      short: 180,
      medium: 240,
      panel: 280,
      feedback: 2200,
      completionHold: 180,
    });
  });

  it("removes JavaScript exit delays when reduced motion is requested", () => {
    expect(effectiveMotionDuration(motionDuration.panel, true)).toBe(0);
    expect(effectiveMotionDuration(motionDuration.panel, false)).toBe(280);
  });
});
