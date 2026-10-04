import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { AiTaskProgress } from "./AiTaskProgress.js";
import { beginAiTask, dismissCompletedAiTasks } from "./aiTaskStore.js";

it("stays hidden while no AI task is running", () => {
  dismissCompletedAiTasks();
  expect(
    renderToStaticMarkup(<AiTaskProgress onOpen={() => undefined} />),
  ).toBe("");
});

it("shows an indeterminate placeholder while a task runs, never a percentage", () => {
  dismissCompletedAiTasks();
  const end = beginAiTask("course-import");
  try {
    const markup = renderToStaticMarkup(
      <AiTaskProgress onOpen={() => undefined} />,
    );
    expect(markup).toContain("ai-task-progress");
    expect(markup).toContain("phase-running");
    expect(markup).toContain("AI 正在后台处理中");
    expect(markup).toContain("bar-one");
    expect(markup).toContain("bar-two");
    // The backend exposes no real progress value, so no number may leak out.
    expect(markup).not.toMatch(/\d+\s*%/);
  } finally {
    end();
    dismissCompletedAiTasks();
  }
});

it("keeps a finished task as a clickable hint until it is opened", () => {
  dismissCompletedAiTasks();
  const end = beginAiTask("course-import");
  end();
  try {
    const markup = renderToStaticMarkup(
      <AiTaskProgress onOpen={() => undefined} />,
    );
    expect(markup).toContain("phase-completed");
    expect(markup).toContain("课表识别完成，点击查看");
    expect(markup).toContain("<button");
    expect(markup).toContain('data-kind="course-import"');
    expect(markup).not.toMatch(/\d+\s*%/);
  } finally {
    dismissCompletedAiTasks();
  }
});

it("prefers the import hint when a wave mixed both kinds", () => {
  dismissCompletedAiTasks();
  const endCapture = beginAiTask("capture");
  const endImport = beginAiTask("course-import");
  endCapture();
  endImport();
  try {
    const markup = renderToStaticMarkup(
      <AiTaskProgress onOpen={() => undefined} />,
    );
    expect(markup).toContain('data-kind="course-import"');
    expect(markup).toContain("课表识别完成，点击查看");
  } finally {
    dismissCompletedAiTasks();
  }
});
