import { expect, it } from "vitest";
import { reminderLevelForCapture } from "./captureParsing.js";

it("raises the reminder level only for an explicit reminder request", () => {
  expect(reminderLevelForCapture("111大赛，10月30日前提交作品，提醒我")).toBe(
    "HIGH",
  );
  expect(reminderLevelForCapture("记得提醒我交房租")).toBe("HIGH");
  expect(reminderLevelForCapture("管理学原理，第一次作业，9月28日前提交")).toBe(
    "NORMAL",
  );
  expect(reminderLevelForCapture("找学姐要环境经济学笔记")).toBe("NORMAL");
});
