import type { Item } from "@course-manager/domain";
import { apiBase } from "./apiBase.js";
import {
  REMINDER_POLICY_V1,
  REMINDER_QUIET_HOURS_V1,
  ReminderCoordinator,
  createReminderWindow,
  type QuietHours,
  type ReminderDeliveryPort,
  type ReminderEvent,
  type ReminderPolicy,
  type ReminderRepository,
  type ReminderWindow,
} from "@course-manager/application";

export const reminderPolicySource = (): string | null =>
  (import.meta.env.VITE_REMINDER_POLICY as string | undefined) ?? null;

/**
 * R-01 is fixed as product policy v1, so the engine runs with it by default.
 * `VITE_REMINDER_POLICY` stays an override for experiments and tests, and a
 * malformed override falls back to the product policy instead of silently
 * disabling reminders.
 */
export function loadReminderPolicy(
  source = reminderPolicySource(),
): ReminderPolicy {
  if (!source) return REMINDER_POLICY_V1;
  try {
    const value = JSON.parse(source) as ReminderPolicy;
    if (!value.version || !value.levels?.NORMAL || !value.levels?.HIGH)
      return REMINDER_POLICY_V1;
    return value;
  } catch {
    return REMINDER_POLICY_V1;
  }
}

export interface ReminderRuntimeConfig {
  quietHours?: QuietHours | null;
  timeZone?: string;
}

export function loadReminderRuntimeConfig(
  source: string | null = (import.meta.env.VITE_REMINDER_QUIET_HOURS as
    string | undefined) ?? null,
): ReminderRuntimeConfig {
  if (!source) return { quietHours: REMINDER_QUIET_HOURS_V1 };
  try {
    const parsed = JSON.parse(source) as ReminderRuntimeConfig;
    return {
      ...parsed,
      quietHours: parsed.quietHours ?? REMINDER_QUIET_HOURS_V1,
    };
  } catch {
    return { quietHours: REMINDER_QUIET_HOURS_V1 };
  }
}

export function createAppReminderWindow(
  from: string,
  to: string,
  config: ReminderRuntimeConfig = {},
): ReminderWindow {
  return createReminderWindow({
    from,
    to,
    ...(config.timeZone ? { timeZone: config.timeZone } : {}),
    quietHours: config.quietHours ?? null,
  });
}

export interface NotificationAdapter {
  /** Platform notification for one delivery; a click opens the current Item. */
  show(event: ReminderEvent, item: Item): void;
  cancel(logicalKey: string): void;
  /** Browsers only allow permission prompts from a user gesture. */
  armPermissionRequest(): void;
}

type NotificationCtor = new (
  title: string,
  options?: NotificationOptions,
) => {
  onclick: ((this: unknown, event: Event) => unknown) | null;
  close(): void;
};

/** Windows / Mobile browser adapter; native shells can implement the same port. */
export class BrowserNotificationAdapter implements NotificationAdapter {
  private readonly shown = new Map<string, { close(): void }>();
  private armed = false;

  constructor(
    private readonly openItem: (item: Item, logicalKey: string) => void,
    private readonly notice: (text: string) => void = () => {},
    private readonly ctor: NotificationCtor | null = typeof Notification ===
    "undefined"
      ? null
      : (Notification as unknown as NotificationCtor),
    private readonly permission: () => NotificationPermission = () =>
      typeof Notification === "undefined" ? "denied" : Notification.permission,
  ) {}

  armPermissionRequest(): void {
    if (
      typeof window === "undefined" ||
      this.armed ||
      !this.ctor ||
      this.permission() !== "default"
    )
      return;
    this.armed = true;
    const request = () => {
      window.removeEventListener("pointerdown", request);
      window.removeEventListener("keydown", request);
      void Notification.requestPermission();
    };
    window.addEventListener("pointerdown", request, { once: true });
    window.addEventListener("keydown", request, { once: true });
  }

  show(event: ReminderEvent, item: Item): void {
    if (!this.ctor || this.permission() !== "granted") {
      // Local first: without notification permission the user still sees why.
      this.notice(item.title);
      return;
    }
    const existing = this.shown.get(event.logical_key);
    existing?.close();
    const notification = new this.ctor(item.title, {
      body: item.detail ?? itemReminderSummary(item),
      tag: event.logical_key,
    });
    notification.onclick = () => {
      this.openItem(item, event.logical_key);
      notification.close();
    };
    this.shown.set(event.logical_key, notification);
  }

  cancel(logicalKey: string): void {
    this.shown.get(logicalKey)?.close();
    this.shown.delete(logicalKey);
  }
}

function itemReminderSummary(item: Item): string {
  const time = item.due_at ?? item.occurrence_start_at ?? item.start_at;
  return time ? new Date(time).toLocaleString() : "";
}

/**
 * Claim goes through the server while both devices are reachable; any failure
 * (offline, signed out, endpoint missing) keeps local delivery reliable.
 */
export class WebReminderDeliveryPort implements ReminderDeliveryPort {
  private readonly claimIds = new Map<string, string>();

  constructor(
    private readonly adapter: NotificationAdapter,
    private readonly options: {
      deviceId: () => string;
      getItem: (itemId: string) => Promise<Item | undefined>;
      accessToken?: () => Promise<string | null>;
      transport?: typeof fetch;
      endpoint?: string;
      registerDevice?: (platform: "MOBILE" | "WINDOWS") => Promise<void>;
    },
  ) {}

  private async post(
    path: string,
    body: unknown,
  ): Promise<Record<string, unknown> | null> {
    if (!this.options.accessToken) return null;
    const token = await this.options.accessToken();
    if (!token) return null;
    try {
      const response = await (this.options.transport ?? fetch)(
        `${this.options.endpoint ?? `${apiBase()}/api/v1`}${path}`,
        {
          method: "POST",
          headers: {
            authorization: ["Bearer", token].join(" "),
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        },
      );
      if (!response.ok) return null;
      const parsed = (await response.json()) as {
        data?: Record<string, unknown>;
      };
      return parsed.data ?? null;
    } catch {
      return null;
    }
  }

  async claim(event: ReminderEvent): Promise<boolean> {
    await this.options.registerDevice?.(devicePlatform());
    const result = await this.post("/notifications/claim", {
      device_id: this.options.deviceId(),
      logical_key: event.logical_key,
      item_id: event.item_id,
      reminder_rule_key: event.rule_key,
      scheduled_for: event.scheduled_for,
      policy_version: event.policy_version,
    });
    if (result?.claimed === false) {
      this.claimIds.delete(event.logical_key);
      return false;
    }
    if (typeof result?.delivery_id === "string")
      this.claimIds.set(event.logical_key, result.delivery_id);
    return true;
  }

  async deliver(event: ReminderEvent): Promise<void> {
    const item = await this.options.getItem(event.item_id);
    if (item) this.adapter.show(event, item);
    const deliveryId = this.claimIds.get(event.logical_key);
    if (deliveryId)
      await this.post(`/notifications/${deliveryId}/delivered`, {
        device_id: this.options.deviceId(),
      });
  }

  async cancel(logicalKey: string): Promise<void> {
    this.claimIds.delete(logicalKey);
    this.adapter.cancel(logicalKey);
    await this.post("/notifications/cancel", { logical_keys: [logicalKey] });
  }
}

export function devicePlatform(): "MOBILE" | "WINDOWS" {
  const agent = typeof navigator === "undefined" ? "" : navigator.userAgent;
  return /Windows/i.test(agent) ? "WINDOWS" : "MOBILE";
}

export function localDeviceId(): string {
  const key = "course_manager_device_id";
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const created = crypto.randomUUID();
  localStorage.setItem(key, created);
  return created;
}

export interface ReminderSchedulerOptions {
  repository: ReminderRepository & {
    getItem(itemId: string): Promise<Item | undefined>;
  };
  policy: ReminderPolicy;
  delivery: ReminderDeliveryPort;
  items: () => Item[];
  now?: () => string;
}

/** Reconcile cancels stale keys after completion, deletion or a time change. */
export class ReminderScheduler {
  private readonly coordinator: ReminderCoordinator;
  private running = false;

  constructor(private readonly options: ReminderSchedulerOptions) {
    this.coordinator = new ReminderCoordinator(
      options.repository,
      options.delivery,
    );
  }

  /** Opening a notification consumes that instance without completing the Item. */
  async consume(logicalKey: string): Promise<Item | null> {
    return this.coordinator.consume(logicalKey);
  }

  async tick(window: ReminderWindow): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      await this.coordinator.reconcile(
        this.options.items(),
        this.options.policy,
        window,
      );
      const now = this.options.now?.() ?? new Date().toISOString();
      // Quiet hours gate delivery too: an already-due reminder waits for the
      // next allowed slot instead of interrupting the night.
      if (Date.parse(window.nextAllowedTime(now)) > Date.parse(now)) return 0;
      return await this.coordinator.deliverDue(now, this.options.policy);
    } finally {
      this.running = false;
    }
  }
}
