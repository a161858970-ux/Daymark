import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { I18nProvider } from "./i18n/index.js";
import {
  TimeBlock,
  formatOccurrence,
  formatStamp,
  timeSummaries,
} from "./TimeBlock.js";

const empty = {
  startAt: "",
  startDate: "",
  occurrenceStartAt: "",
  occurrenceStartDate: "",
  occurrenceEndAt: "",
  occurrenceEndDate: "",
  dueAt: "",
  dueDate: "",
};

it("keeps any real clock time and formats date-only without inventing 00:00", () => {
  expect(formatStamp("2026-09-24T23:59", "zh-CN")).toBe("9月24日 23:59");
  expect(formatStamp("2026-09-20", "zh-CN")).toBe("9月20日");
  expect(formatStamp("2026-09-20T00:00", "zh-CN", true)).toBe("9月20日 00:00");
  expect(formatStamp("", "zh-CN")).toBe("");
});

it("speaks 发生 as a DATE span or DATETIME point/span", () => {
  expect(formatOccurrence("", "2026-09-25T19:00", "", "", "zh-CN")).toBe(
    "9月25日 19:00 发生",
  );
  expect(
    formatOccurrence("", "2026-09-25T19:00", "", "2026-09-25T20:30", "zh-CN"),
  ).toBe("9月25日 19:00–20:30 发生");
  expect(
    formatOccurrence("", "2026-09-25T19:00", "", "2026-09-26T08:30", "zh-CN"),
  ).toBe("9月25日 19:00–9月26日 08:30 发生");
  expect(formatOccurrence("2026-10-14", "", "", "", "zh-CN")).toBe(
    "10月14日 发生",
  );
  expect(formatOccurrence("2026-10-14", "", "2026-10-16", "", "zh-CN")).toBe(
    "10月14日–10月16日 发生",
  );
  expect(formatOccurrence("", "", "", "2026-09-26T08:30", "zh-CN")).toBe("");
});

it("summarises whichever semantics are set, in 开始/发生/截止 order", () => {
  expect(timeSummaries(empty, "zh-CN")).toEqual([]);
  expect(
    timeSummaries(
      {
        startAt: "",
        startDate: "2026-09-20",
        occurrenceStartAt: "2026-09-25T19:00",
        occurrenceStartDate: "",
        occurrenceEndAt: "2026-09-25T20:30",
        occurrenceEndDate: "",
        dueAt: "2026-09-24T23:59",
        dueDate: "",
      },
      "zh-CN",
    ).map((entry) => entry.text),
  ).toEqual([
    "开始于 9月20日",
    "9月25日 19:00–20:30 发生",
    "截止于 9月24日 23:59",
  ]);
});

it("renders 时间未定 when nothing is set, without leaking column names", () => {
  const markup = renderToStaticMarkup(
    <I18nProvider>
      <TimeBlock value={empty} onChange={() => undefined} />
    </I18nProvider>,
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
    <I18nProvider>
      <TimeBlock
        value={{
          ...empty,
          startDate: "2026-09-20",
          dueAt: "2026-09-24T23:59",
        }}
        onChange={() => undefined}
      />
    </I18nProvider>,
  );
  expect(markup).toContain("开始于 9月20日");
  expect(markup).toContain("截止于 9月24日 23:59");
  expect(markup).toContain("调整时间");
  expect(markup).not.toContain("时间未定");
});
