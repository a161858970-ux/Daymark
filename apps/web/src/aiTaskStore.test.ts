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
  expect(getAiTaskSnapshot()).toEqual({ active: 2, completed: [] });

  endCapture();
  endCapture(); // a double settle must not drive the counter negative
  expect(getAiTaskSnapshot()).toEqual({ active: 1, completed: [] });

  endImport();
  expect(getAiTaskSnapshot()).toEqual({
    active: 0,
    completed: ["course-import", "capture"],
  });

  // The hint is what takes the user to the result, so it must not expire.
  expect(getAiTaskSnapshot().completed).toHaveLength(2);
  dismissCompletedAiTasks();
  expect(getAiTaskSnapshot()).toEqual({ active: 0, completed: [] });

  // A new wave supersedes any stale completion.
  const endAgain = beginAiTask("capture");
  expect(getAiTaskSnapshot()).toEqual({ active: 1, completed: [] });
  endAgain();
  expect(getAiTaskSnapshot()).toEqual({ active: 0, completed: ["capture"] });

  expect(seen).toEqual([1, 2, 1, 0, 0, 1, 0]);
  unsubscribe();
});
