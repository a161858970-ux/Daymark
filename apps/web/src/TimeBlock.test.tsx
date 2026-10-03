import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import {
  TimeBlock,
  formatOccurrence,
  formatStamp,
  timeSummaries,
} from "./TimeBlock.js";

const empty = {
  startAt: "",
  occurrenceStartAt: "",
  occurrenceEndAt: "",
  dueAt: "",
};

it("reads midnight as a date and keeps any real clock time", () => {
  expect(formatStamp("2026-09-20T00:00")).toBe("9月20日");
  expect(formatStamp("2026-09-24T23:59")).toBe("9月24日 23:59");
  expect(formatStamp("2026-09-20T00:00", true)).toBe("9月20日 00:00");
  expect(formatStamp("")).toBe("");
});

it("speaks 发生 as a point or a span", () => {
  expect(formatOccurrence("2026-09-25T19:00", "")).toBe("9月25日 19:00 发生");
  expect(formatOccurrence("2026-09-25T19:00", "2026-09-25T20:30")).toBe(
    "9月25日 19:00–20:30 发生",
  );
  expect(formatOccurrence("2026-09-25T19:00", "2026-09-26T08:30")).toBe(
    "9月25日 19:00–9月26日 08:30 发生",
  );
  expect(formatOccurrence("", "2026-09-26T08:30")).toBe("");
});

it("summarises whichever semantics are set, in 开始/发生/截止 order", () => {
  expect(timeSummaries(empty)).toEqual([]);
  expect(
    timeSummaries({
      startAt: "2026-09-20T00:00",
      occurrenceStartAt: "2026-09-25T19:00",
      occurrenceEndAt: "2026-09-25T20:30",
      dueAt: "2026-09-24T23:59",
    }).map((entry) => entry.text),
  ).toEqual([
    "开始于 9月20日",
    "9月25日 19:00–20:30 发生",
    "截止于 9月24日 23:59",
  ]);
});

it("renders 时间未定 when nothing is set, without leaking column names", () => {
  const markup = renderToStaticMarkup(
    <TimeBlock value={empty} onChange={() => undefined} />,
  );
  expect(markup).toContain("时间未定");
  expect(markup).toContain("设置时间");
  expect(markup).not.toContain("occurrence");
  expect(markup).not.toContain("start_at");
  expect(markup).not.toContain("due_at");
  // Collapsed: no pickers open, and nothing is mandatory.
  expect(markup).not.toContain('role="dialog"');
  expect(markup).not.toContain("required");
});

it("shows the set semantics as prose with an entry point to edit", () => {
  const markup = renderToStaticMarkup(
    <TimeBlock
      value={{
        startAt: "2026-09-20T00:00",
        occurrenceStartAt: "",
        occurrenceEndAt: "",
        dueAt: "2026-09-24T23:59",
      }}
      onChange={() => undefined}
    />,
  );
  expect(markup).toContain("开始于 9月20日");
  expect(markup).toContain("截止于 9月24日 23:59");
  expect(markup).toContain("调整时间");
  expect(markup).not.toContain("时间未定");
});
