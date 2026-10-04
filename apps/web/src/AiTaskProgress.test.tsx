import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { AiTaskProgress } from "./AiTaskProgress.js";
import { beginAiTask, getAiTaskCount } from "./aiTaskStore.js";

it("stays hidden while no AI task is running", () => {
  expect(getAiTaskCount()).toBe(0);
  expect(renderToStaticMarkup(<AiTaskProgress />)).toBe("");
});

it("shows an indeterminate placeholder for a running task, never a percentage", () => {
  const end = beginAiTask();
  try {
    const markup = renderToStaticMarkup(<AiTaskProgress />);
    expect(markup).toContain("ai-task-progress");
    expect(markup).toContain("phase-running");
    expect(markup).toContain("AI 正在后台处理");
    expect(markup).toContain("bar-one");
    expect(markup).toContain("bar-two");
    // The backend exposes no real progress value, so no number may leak out.
    expect(markup).not.toMatch(/\d+\s*%/);
  } finally {
    end();
  }
});
