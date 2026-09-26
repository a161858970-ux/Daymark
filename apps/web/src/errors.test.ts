import { expect, it } from "vitest";
import { toUserMessage } from "./errors.js";

it("keeps product copy, translates engineering messages and hides internals", () => {
  // Already-product Chinese copy passes through.
  expect(toUserMessage(new Error("请确认这条记录对应的时间"))).toBe(
    "请确认这条记录对应的时间",
  );

  // Known engineering messages become product language.
  expect(toUserMessage(new Error("Record cannot be empty"))).toBe(
    "记录内容不能为空。",
  );
  expect(
    toUserMessage(new Error("Raw capture has already been resolved")),
  ).toBe("这条记录已经处理过了。");
  expect(toUserMessage(new Error("fetch failed"))).toBe(
    "网络连接不可用，请稍后重试。",
  );
  expect(toUserMessage(new Error("AI_UNAVAILABLE"))).toBe(
    "智能整理暂时不可用，请稍后重试。",
  );
  expect(toUserMessage(new Error("If-Match row version is required"))).toBe(
    "这条内容已在其他设备更新，请刷新后重试。",
  );

  // Anything unrecognised falls back instead of leaking internals.
  expect(
    toUserMessage(new Error("SELECT * FROM items WHERE owner_id=$1")),
  ).toBe("操作未完成，请稍后重试。");
  expect(toUserMessage({ mutation_id: "abc", outbox: [] })).toBe(
    "操作未完成，请稍后重试。",
  );
  expect(toUserMessage(undefined)).toBe("操作未完成，请稍后重试。");
  expect(toUserMessage(new Error("Error: something"))).not.toContain("Error:");
});
