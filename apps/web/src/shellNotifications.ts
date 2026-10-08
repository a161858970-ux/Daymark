import type { Item } from "@daymark/domain";
import type { ReminderEvent } from "@daymark/application";
import {
  active,
  cancel as cancelByIds,
  isPermissionGranted,
  onAction,
  requestPermission,
  Schedule,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import {
  BrowserNotificationAdapter,
  itemReminderSummary,
  type NotificationAdapter,
} from "./reminders.js";
import { isAndroid, isTauri } from "./apiBase.js";

/**
 * Shell implementation of the NotificationAdapter port (reminders.ts line
 * "native shells can implement the same port"): WebViews have no usable
 * `Notification` constructor, so shell reminders would silently degrade to
 * in-app banners. The Tauri notification plugin posts real system
 * notifications, and on Android it also gives us the two capabilities the
 * app needs end-to-end:
 *
 * - **Scheduling** (`Schedule.at`): each FUTURE reminder is handed to the OS,
 *   so it fires even when the process was killed from recents — the in-app
 *   15 s tick only ever runs while the app lives. Same numeric id as `show`,
 *   so an in-app delivery replaces the pending OS entry instead of doubling.
 * - **Tap callback** (`onAction`): the notification carries `item_id` and
 *   `logical_key` in `extra`; tapping opens that exact Item.
 *
 * Platform limits (verified in plugin source 2.5.1): the desktop
 * implementation ignores scheduling and action options — on Windows a tap
 * neither fires `onAction` nor can be made to; reminders there still depend
 * on the app being alive (documented, not fixable from JS).
 */
export class ShellNotificationAdapter implements NotificationAdapter {
  private armed = false;
  /** id → scheduled instant already handed to the OS (avoid resending churn). */
  private readonly scheduled = new Map<number, string>();

  constructor(
    private readonly openItem: (item: Item, logicalKey: string) => void,
    private readonly getItem: (itemId: string) => Promise<Item | undefined>,
    private readonly notice: (text: string) => void = () => {},
  ) {
    // Tap → open the exact item. Registration is harmless on Windows (the
    // event simply never fires there).
    void onAction((notification) => {
      const extra = (notification as { extra?: Record<string, unknown> }).extra;
      const itemId = extra?.item_id;
      const logicalKey = extra?.logical_key;
      if (typeof itemId !== "string" || typeof logicalKey !== "string") return;
      void this.getItem(itemId).then((item) => {
        if (item) this.openItem(item, logicalKey);
      });
    }).catch(() => undefined);
  }

  armPermissionRequest(): void {
    if (typeof window === "undefined" || this.armed) return;
    this.armed = true;
    const request = () => {
      window.removeEventListener("pointerdown", request);
      window.removeEventListener("keydown", request);
      void (async () => {
        if (!(await isPermissionGranted())) await requestPermission();
      })();
    };
    window.addEventListener("pointerdown", request, { once: true });
    window.addEventListener("keydown", request, { once: true });
  }

  show(event: ReminderEvent, item: Item): void {
    void (async () => {
      if (!(await isPermissionGranted())) {
        // Local first: without notification permission the user still sees why.
        this.notice(item.title);
        return;
      }
      const id = notificationId(event.logical_key);
      if (isAndroid()) {
        try {
          // The scheduled OS copy may have just fired — don't post twice.
          const visible = await active();
          if (visible.some((entry) => entry.id === id)) return;
        } catch {
          // Capability missing → fall through and post immediately.
        }
      }
      sendNotification({
        id,
        title: item.title,
        body: item.detail ?? itemReminderSummary(item),
        extra: {
          item_id: event.item_id,
          logical_key: event.logical_key,
        },
      });
    })();
  }

  schedule(event: ReminderEvent, item: Item): void {
    if (!isAndroid()) return; // desktop plugin ignores scheduling (would show NOW)
    const id = notificationId(event.logical_key);
    if (this.scheduled.get(id) === event.scheduled_for) return; // already handed over
    if (Date.parse(event.scheduled_for) <= Date.now() + 5_000) return;
    this.scheduled.set(id, event.scheduled_for);
    try {
      sendNotification({
        id,
        title: item.title,
        body: item.detail ?? itemReminderSummary(item),
        extra: {
          item_id: event.item_id,
          logical_key: event.logical_key,
        },
        // allowWhileIdle: fire through Doze instead of waiting for the next
        // maintenance window.
        schedule: Schedule.at(new Date(event.scheduled_for), false, true),
      });
    } catch {
      this.scheduled.delete(id); // e.g. rejected date → retry next tick
    }
  }

  cancel(logicalKey: string): void {
    const id = notificationId(logicalKey);
    this.scheduled.delete(id);
    void cancelByIds([id]).catch(() => undefined); // no-op on desktop
  }
}

/**
 * The plugin's id must be a 32-bit integer, while browser tags are strings —
 * a stable FNV-1a hash of the logical key keeps the "same reminder replaces
 * its previous toast" semantics (collisions collapse two simultaneous
 * reminders visually; rare and harmless).
 */
export function notificationId(logicalKey: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < logicalKey.length; index += 1) {
    hash ^= logicalKey.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash | 0;
}

/** The shell (Tauri) gets system notifications; plain browsers keep theirs. */
export function createNotificationAdapter(options: {
  openItem: (item: Item, logicalKey: string) => void;
  getItem: (itemId: string) => Promise<Item | undefined>;
  notice: (text: string) => void;
}): NotificationAdapter {
  return isTauri()
    ? new ShellNotificationAdapter(
        options.openItem,
        options.getItem,
        options.notice,
      )
    : new BrowserNotificationAdapter(options.openItem, options.notice);
}
