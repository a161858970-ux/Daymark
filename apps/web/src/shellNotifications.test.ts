import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Item } from "@daymark/domain";
import {
  createNotificationAdapter,
  notificationId,
  ShellNotificationAdapter,
} from "./shellNotifications.js";
import { BrowserNotificationAdapter } from "./reminders.js";

const mocks = vi.hoisted(() => {
  const state = {
    granted: vi.fn(),
    request: vi.fn(),
    send: vi.fn(),
    active: vi.fn(),
    cancelIds: vi.fn(),
    at: vi.fn((date: Date) => ({ at: date.toISOString() })),
    actionCb: null as ((n: unknown) => unknown) | null,
    onAction: vi.fn((cb: (n: unknown) => unknown) => {
      state.actionCb = cb;
      return Promise.resolve({});
    }),
  };
  return state;
});

vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: mocks.granted,
  requestPermission: mocks.request,
  sendNotification: mocks.send,
  active: mocks.active,
  cancel: mocks.cancelIds,
  onAction: mocks.onAction,
  Schedule: { at: mocks.at },
}));

const item = {
  id: "item-1",
  title: "提交作业",
  detail: "周三前交",
} as unknown as Item;
const event = {
  logical_key: "item-1:start:once:v1:2026",
  item_id: "item-1",
  scheduled_for: "2099-01-01T10:00:00.000Z",
} as Parameters<ShellNotificationAdapter["show"]>[0];

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setEnv(options: { tauri?: boolean; android?: boolean } = {}) {
  Object.assign(globalThis, {
    window: { dispatchEvent: () => true, addEventListener: () => undefined },
    document: { querySelectorAll: () => [] },
    getComputedStyle: () => ({
      display: "none",
      visibility: "visible",
      opacity: "1",
    }),
    KeyboardEvent: class {},
  });
  if (options.tauri) {
    (globalThis as { window: unknown }).window = Object.assign(
      (globalThis as { window: object }).window,
      { __TAURI_INTERNALS__: {} },
    );
  }
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      userAgent: options.android ? "Linux; Android 15" : "Node.js/24",
    },
  });
}

beforeEach(() => {
  mocks.granted.mockReset().mockResolvedValue(true);
  mocks.request.mockReset();
  mocks.send.mockReset();
  mocks.active.mockReset().mockResolvedValue([]);
  mocks.cancelIds.mockReset().mockResolvedValue(undefined);
  mocks.at.mockClear();
  mocks.onAction.mockClear();
  mocks.actionCb = null;
});

afterEach(() => {
  for (const key of [
    "window",
    "document",
    "getComputedStyle",
    "KeyboardEvent",
    "navigator",
  ]) {
    delete (globalThis as Record<string, unknown>)[key];
  }
});

describe("ShellNotificationAdapter", () => {
  it("posts with extra item_id/logical_key so a tap can reopen the item", async () => {
    setEnv({ tauri: true, android: true });
    new ShellNotificationAdapter(
      () => undefined,
      async () => item,
    ).show(event, item);
    await flush();
    expect(mocks.send).toHaveBeenCalledTimes(1);
    const sent = mocks.send.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(sent.id).toBe(notificationId(event.logical_key));
    expect(sent.title).toBe("提交作业");
    expect(sent.extra).toEqual({
      item_id: "item-1",
      logical_key: event.logical_key,
    });
  });

  it("skips the immediate post when the scheduled copy is already visible", async () => {
    setEnv({ tauri: true, android: true });
    mocks.active.mockResolvedValue([{ id: notificationId(event.logical_key) }]);
    new ShellNotificationAdapter(
      () => undefined,
      async () => item,
    ).show(event, item);
    await flush();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("hands future reminders to the OS on Android (once per instant)", () => {
    setEnv({ tauri: true, android: true });
    const adapter = new ShellNotificationAdapter(
      () => undefined,
      async () => item,
    );
    adapter.schedule(event, item);
    adapter.schedule(event, item); // same instant → deduped
    expect(mocks.send).toHaveBeenCalledTimes(1);
    const sent = mocks.send.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(sent.schedule).toEqual({ at: event.scheduled_for });
    expect(mocks.at).toHaveBeenCalledWith(
      new Date(event.scheduled_for),
      false,
      true,
    );
  });

  it("never schedules on desktop (the plugin would show it immediately)", () => {
    setEnv({ tauri: true, android: false });
    const adapter = new ShellNotificationAdapter(
      () => undefined,
      async () => item,
    );
    adapter.schedule(event, item);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("opens the exact item when the OS reports a tap (onAction)", async () => {
    setEnv({ tauri: true, android: true });
    const openItem = vi.fn();
    new ShellNotificationAdapter(openItem, async () => item);
    expect(mocks.onAction).toHaveBeenCalledTimes(1);
    await mocks.actionCb?.({
      extra: { item_id: "item-1", logical_key: event.logical_key },
    });
    await flush();
    expect(openItem).toHaveBeenCalledWith(item, event.logical_key);
  });

  it("cancel removes the OS copy by id", () => {
    setEnv({ tauri: true, android: true });
    const adapter = new ShellNotificationAdapter(
      () => undefined,
      async () => item,
    );
    adapter.schedule(event, item);
    adapter.cancel(event.logical_key);
    expect(mocks.cancelIds).toHaveBeenCalledWith([
      notificationId(event.logical_key),
    ]);
  });
});

describe("createNotificationAdapter", () => {
  it("keeps the browser adapter outside the shell", () => {
    setEnv();
    const adapter = createNotificationAdapter({
      openItem: () => undefined,
      getItem: async () => undefined,
      notice: () => undefined,
    });
    expect(adapter).toBeInstanceOf(BrowserNotificationAdapter);
  });

  it("picks the shell adapter inside Tauri", () => {
    setEnv({ tauri: true });
    const adapter = createNotificationAdapter({
      openItem: () => undefined,
      getItem: async () => undefined,
      notice: () => undefined,
    });
    expect(adapter).toBeInstanceOf(ShellNotificationAdapter);
    expect(mocks.onAction).toHaveBeenCalledTimes(1);
  });
});
