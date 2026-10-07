import { describe, expect, it, vi } from "vitest";
import type { Item } from "@course-manager/domain";
import {
  ShellNotificationAdapter,
  createNotificationAdapter,
  notificationId,
} from "./shellNotifications.js";
import { BrowserNotificationAdapter } from "./reminders.js";

const mocks = vi.hoisted(() => ({
  granted: vi.fn(),
  request: vi.fn(),
  send: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: mocks.granted,
  requestPermission: mocks.request,
  sendNotification: mocks.send,
}));

const item = {
  title: "提交作业",
  detail: "周三前交",
} as unknown as Item;
const event = { logical_key: "task-1" } as Parameters<
  ShellNotificationAdapter["show"]
>[0];

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("ShellNotificationAdapter", () => {
  it("posts a system notification with the logical key as id when granted", async () => {
    mocks.granted.mockResolvedValueOnce(true);
    const notice = vi.fn();
    new ShellNotificationAdapter(notice).show(event, item);
    await flush();
    expect(mocks.send).toHaveBeenCalledTimes(1);
    const sent = mocks.send.mock.calls[0]?.[0] as {
      id: number;
      title: string;
      body: string;
    };
    expect(typeof sent.id).toBe("number");
    expect(sent.title).toBe("提交作业");
    expect(sent.body).toBe("周三前交");
    expect(sent.id).toBe(notificationId("task-1"));
    expect(notice).not.toHaveBeenCalled();
  });

  it("falls back to the in-app notice when permission is missing", async () => {
    mocks.granted.mockResolvedValueOnce(false);
    const notice = vi.fn();
    new ShellNotificationAdapter(notice).show(event, item);
    await flush();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(notice).toHaveBeenCalledWith("提交作业");
  });
});

describe("createNotificationAdapter", () => {
  it("keeps the browser adapter outside the shell", () => {
    const adapter = createNotificationAdapter({
      openItem: () => undefined,
      notice: () => undefined,
    });
    expect(adapter).toBeInstanceOf(BrowserNotificationAdapter);
  });
});
