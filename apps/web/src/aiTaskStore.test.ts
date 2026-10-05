import { expect, it } from "vitest";
import {
  beginAiTask,
  dismissCompletedAiTasks,
  getAiTaskSnapshot,
  subscribeAiTasks,
} from "./aiTaskStore.js";

it("counts overlapping tasks and keeps completion until it is dismissed", () => {
  dismissCompletedAiTasks();
  const seen: number[] = [];
  const unsubscribe = subscribeAiTasks(() =>
    seen.push(getAiTaskSnapshot().active),
  );

  const endImport = beginAiTask("course-import");
  const endCapture = beginAiTask("capture");
  expect(getAiTaskSnapshot()).toEqual({ active: 2, completed: [], failed: [] });

  endCapture("ok");
  endCapture("ok"); // a double settle must not drive the counter negative
  expect(getAiTaskSnapshot()).toEqual({ active: 1, completed: [], failed: [] });

  endImport("ok");
  expect(getAiTaskSnapshot()).toEqual({
    active: 0,
    completed: ["course-import", "capture"],
    failed: [],
  });

  // The hint is what takes the user to the result, so it must not expire.
  expect(getAiTaskSnapshot().completed).toHaveLength(2);
  dismissCompletedAiTasks();
  expect(getAiTaskSnapshot()).toEqual({
    active: 0,
    completed: [],
    failed: [],
  });

  // A new wave supersedes any stale completion.
  const endAgain = beginAiTask("capture");
  expect(getAiTaskSnapshot()).toEqual({
    active: 1,
    completed: [],
    failed: [],
  });
  endAgain("ok");
  expect(getAiTaskSnapshot()).toEqual({
    active: 0,
    completed: ["capture"],
    failed: [],
  });

  expect(seen).toEqual([1, 2, 1, 0, 0, 1, 0]);
  unsubscribe();
});

it("records which settled requests failed so the hint cannot lie", () => {
  dismissCompletedAiTasks();
  const endImport = beginAiTask("course-import");
  const endCapture = beginAiTask("capture");
  endImport("failed");
  endCapture("ok");
  expect(getAiTaskSnapshot()).toEqual({
    active: 0,
    completed: ["course-import", "capture"],
    failed: ["course-import"],
  });
  // Dismissing clears the outcome with the hint.
  dismissCompletedAiTasks();
  expect(getAiTaskSnapshot().failed).toEqual([]);
});
