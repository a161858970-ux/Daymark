import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import {
  TimeWheel,
  centerIndexFor,
  notchDelta,
  valueFromIndex,
} from "./TimeWheel.js";

it("wraps scroll indices through the cycle", () => {
  expect(valueFromIndex(0, 24)).toBe(0);
  expect(valueFromIndex(23, 24)).toBe(23);
  // 23 之后继续滚 → 00，无缝接回
  expect(valueFromIndex(24, 24)).toBe(0);
  expect(valueFromIndex(59, 60)).toBe(59);
  expect(valueFromIndex(60, 60)).toBe(0);
  expect(valueFromIndex(-1, 24)).toBe(23);
  expect(valueFromIndex(149, 60)).toBe(29);
});

it("rests every wheel inside the middle repeat at its value", () => {
  expect(centerIndexFor(0, 24)).toBe(72);
  expect(centerIndexFor(15, 24)).toBe(87);
  expect(centerIndexFor(45, 60)).toBe(225);
  expect(valueFromIndex(centerIndexFor(15, 24), 24)).toBe(15);
  expect(valueFromIndex(centerIndexFor(45, 60), 60)).toBe(45);
});

it("renders a spin button with a fixed centre band, not clickable rows", () => {
  const markup = renderToStaticMarkup(
    <TimeWheel
      count={24}
      value={14}
      onChange={() => undefined}
      label="时"
      ariaLabel="小时"
    />,
  );
  expect(markup).toContain('role="spinbutton"');
  expect(markup).toContain('aria-valuenow="14"');
  expect(markup).toContain('aria-valuemax="23"');
  expect(markup).toContain("datetime-wheel-band");
  expect(markup).toContain("datetime-wheel-viewport");
  // Selection is scrolling, so rows are plain text — no buttons to click.
  expect(markup).not.toContain("<button");
});

it("counts wheel input in notches: one notch one row, a long spin keeps its distance", () => {
  // Chrome/Edge: one notch = 100px → exactly one row.
  expect(notchDelta(100, 0)).toBe(1);
  expect(notchDelta(-100, 0)).toBe(-1);
  // A large delta (or many queued notches) covers its full distance.
  expect(notchDelta(500, 0)).toBe(5);
  // Firefox reports lines: three lines is one notch.
  expect(notchDelta(3, 1)).toBe(1);
  expect(notchDelta(-6, 1)).toBe(-2);
  // Partial notches stay queued as a remainder instead of being dropped,
  // which is what made fast scrolling fall behind before.
  expect(notchDelta(50, 0)).toBe(0.5);
  expect(Math.trunc(0.5 + 0.5)).toBe(1);
});
