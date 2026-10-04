import { expect, it } from "vitest";
import {
  beginAiTask,
  getAiTaskCount,
  subscribeAiTasks,
} from "./aiTaskStore.js";

it("counts overlapping AI tasks and settles each one exactly once", () => {
  const seen: number[] = [];
  const unsubscribe = subscribeAiTasks(() => seen.push(getAiTaskCount()));

  const endFirst = beginAiTask();
  const endSecond = beginAiTask();
  expect(getAiTaskCount()).toBe(2);

  endSecond();
  endSecond(); // a double settle must not drive the counter negative
  expect(getAiTaskCount()).toBe(1);

  endFirst();
  expect(getAiTaskCount()).toBe(0);
  expect(seen).toEqual([1, 2, 1, 0]);

  unsubscribe();
  beginAiTask()();
  expect(getAiTaskCount()).toBe(0);
});
