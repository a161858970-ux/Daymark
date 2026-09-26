import { expect, it } from "vitest";
import type { Item } from "@course-manager/domain";
import type { ReminderEvent } from "@course-manager/application";
import {
  BrowserNotificationAdapter,
  ReminderScheduler,
  WebReminderDeliveryPort,
  loadReminderPolicy,
} from "./reminders.js";
import type { LocalReminderRecord } from "@course-manager/application";

const item: Item = {
  id: "11111111-1111-4111-8111-111111111111",
  owner_id: "22222222-2222-4222-8222-222222222222",
  course_id: null,
  title: "提交报告",
  detail: "在群里提交",
  status: "INCOMPLETE",
  start_at: null,
  occurrence_start_at: null,
  occurrence_end_at: null,
  due_at: "2026-09-26T12:00:00.000Z",
  reminder_level: "NORMAL",
  completed_at: null,
  raw_capture_id: null,
  created_at: "2026-09-26T08:00:00.000Z",
  updated_at: "2026-09-26T08:00:00.000Z",
  deleted_at: null,
  row_version: 1,
};

const event: ReminderEvent = {
  logical_key: `${item.id}:due:before:86400000:fixture-v1`,
  item_id: item.id,
  owner_id: item.owner_id,
  rule_key: "due:before:86400000",
  scheduled_for: "2026-09-26T00:00:00.000Z",
  policy_version: "fixture-v1",
  item_snapshot_key: "snapshot",
};

function fakeAdapter() {
  return {
    shown: [] as ReminderEvent[],
    canceled: [] as string[],
    show(event: ReminderEvent) {
      this.shown.push(event);
    },
    cancel(key: string) {
      this.canceled.push(key);
    },
    armPermissionRequest() {},
  };
}

function harness(
  respond: (path: string, body: unknown) => Record<string, unknown> | Error,
) {
  const calls: { path: string; body: unknown }[] = [];
  const transport = async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = String(url).replace("/api/v1", "");
    const body = JSON.parse(String(init?.body)) as unknown;
    calls.push({ path, body });
    const result = respond(path, body);
    if (result instanceof Error) throw result;
    return new Response(JSON.stringify({ data: result }), { status: 200 });
  };
  const adapter = fakeAdapter();
  const registered: string[] = [];
  const port = new WebReminderDeliveryPort(adapter, {
    deviceId: () => "device-a",
    getItem: async () => item,
    accessToken: async () => "access-token",
    transport: transport as unknown as typeof fetch,
    registerDevice: async (platform) => {
      registered.push(platform);
    },
  });
  return { port, adapter, calls, registered };
}

it("returns null without an injected policy and rejects malformed JSON", () => {
  expect(loadReminderPolicy(null)).toBeNull();
  expect(loadReminderPolicy("{not json")).toBeNull();
  expect(loadReminderPolicy(JSON.stringify({ version: "v1" }))).toBeNull();
});

it("claims through the server, acknowledges the delivery and shows it once", async () => {
  const { port, adapter, calls } = harness((path) => {
    if (path === "/notifications/claim")
      return { claimed: true, delivery_id: "delivery-1" };
    return {};
  });
  await expect(port.claim(event)).resolves.toBe(true);
  await port.deliver(event);
  expect(adapter.shown).toHaveLength(1);
  const paths = calls.map((call) => call.path);
  expect(paths).toEqual([
    "/notifications/claim",
    "/notifications/delivery-1/delivered",
  ]);
});

it("keeps local delivery when the other device holds the lease", async () => {
  const { port, adapter } = harness(() => ({
    claimed: false,
    delivery_id: "delivery-1",
    reason: "LEASED",
  }));
  // ReminderCoordinator only calls deliver() after a successful claim.
  await expect(port.claim(event)).resolves.toBe(false);
  expect(adapter.shown).toHaveLength(0);
});

it("stays reliable offline: network failure still allows local delivery", async () => {
  const { port, adapter } = harness(() => new Error("offline"));
  await expect(port.claim(event)).resolves.toBe(true);
  await port.deliver(event);
  expect(adapter.shown).toHaveLength(1);
});

it("cancels the platform notification and mirrors it to the server", async () => {
  const { port, adapter, calls } = harness(() => ({ canceled: 1 }));
  await port.cancel(event.logical_key);
  expect(adapter.canceled).toEqual([event.logical_key]);
  expect(calls.map((call) => call.path)).toEqual(["/notifications/cancel"]);
});

it("opens the current Item when a notification is clicked", () => {
  const opened: { item: Item; key: string }[] = [];
  const created: {
    onclick: ((event: Event) => unknown) | null;
    close(): void;
    options?: NotificationOptions | undefined;
  }[] = [];
  class FakeNotification {
    onclick: ((event: Event) => unknown) | null = null;
    close() {}
    constructor(
      readonly title: string,
      readonly options?: NotificationOptions,
    ) {
      created.push(this);
    }
  }
  const adapter = new BrowserNotificationAdapter(
    (target, key) => opened.push({ item: target, key }),
    () => {},
    FakeNotification as unknown as new (
      title: string,
      options?: NotificationOptions,
    ) => { onclick: ((event: Event) => unknown) | null; close(): void },
    () => "granted",
  );
  adapter.show(event, item);
  expect(created).toHaveLength(1);
  expect(created[0]!.options?.tag).toBe(event.logical_key);
  expect(opened).toHaveLength(0);
  created[0]!.onclick?.(new Event("click"));
  expect(opened).toEqual([{ item, key: event.logical_key }]);
});

it("falls back to an in-app notice when notification permission is missing", () => {
  const notices: string[] = [];
  const adapter = new BrowserNotificationAdapter(
    () => {},
    (title) => notices.push(title),
    null,
    () => "denied",
  );
  adapter.show(event, item);
  adapter.cancel(event.logical_key);
  expect(notices).toEqual([item.title]);
});

// Fixture numbers exercise the configurable interface; production stays gated on R-01.
const hour = 60 * 60 * 1000;
const policy = {
  version: "fixture-v1",
  levels: {
    NORMAL: {
      due_leads_ms: [2 * hour],
      occurrence_leads_ms: [hour],
      overdue_interval_ms: 4 * hour,
      occurrence_after_interval_ms: 8 * hour,
    },
    HIGH: {
      due_leads_ms: [3 * hour],
      occurrence_leads_ms: [hour],
      overdue_interval_ms: 2 * hour,
      occurrence_after_interval_ms: 6 * hour,
    },
  },
  start_offset_ms: 0,
  max_per_local_day: 10,
  dedup_window_ms: 0,
};

const windowFor = (from: string, to: string) => ({
  from,
  to,
  nextAllowedTime: (instant: string) => instant,
  localDayKey: (instant: string) => instant.slice(0, 10),
});

function fakePort() {
  const delivered: ReminderEvent[] = [];
  const canceled: string[] = [];
  return {
    delivered,
    canceled,
    port: {
      claim: async () => true,
      deliver: async (value: ReminderEvent) => {
        delivered.push(value);
      },
      cancel: async (key: string) => {
        canceled.push(key);
      },
    },
  };
}

function memoryRepository(read: () => Item) {
  const records = new Map<string, LocalReminderRecord>();
  return {
    getItem: async () => read(),
    async transaction<T>(work: () => Promise<T>) {
      return work();
    },
    async listReminderRecords() {
      return [...records.values()];
    },
    async putReminderRecord(record: LocalReminderRecord) {
      records.set(record.logical_key, record);
    },
    records,
  };
}

it("scheduler delivers due records and stops after completion", async () => {
  let current: Item = { ...item };
  const repository = memoryRepository(() => current);
  const track = fakePort();
  const scheduler = new ReminderScheduler({
    repository,
    policy,
    delivery: track.port,
    items: () => [current],
    now: () => "2026-09-26T13:00:00.000Z",
  });
  const window = windowFor(
    "2026-09-26T00:00:00.000Z",
    "2026-09-27T00:00:00.000Z",
  );

  await expect(scheduler.tick(window)).resolves.toBe(1);
  expect(track.delivered).toHaveLength(1);
  expect([...repository.records.values()][0]!.state).toBe("DELIVERED");
  await expect(
    scheduler.consume(track.delivered[0]!.logical_key),
  ).resolves.toMatchObject({
    id: item.id,
    status: "INCOMPLETE",
  });

  // Completion stops future deliveries.
  current = {
    ...current,
    status: "COMPLETE",
    completed_at: "2026-09-26T13:05:00.000Z",
  };
  await expect(
    scheduler.tick(
      windowFor("2026-09-26T13:00:00.000Z", "2026-09-27T00:00:00.000Z"),
    ),
  ).resolves.toBe(0);
  expect(track.delivered).toHaveLength(1);
});
