import type { Item } from "@course-manager/domain";
import type { ReminderEvent } from "@course-manager/application";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import {
  BrowserNotificationAdapter,
  itemReminderSummary,
  type NotificationAdapter,
} from "./reminders.js";
import { isTauri } from "./apiBase.js";

/**
 * Shell implementation of the NotificationAdapter port (reminders.ts line
 * "native shells can implement the same port"): WebViews have no usable
 * `Notification` constructor, so shell reminders used to degrade to in-app
 * banners — the root of "permission granted but nothing arrives". The Tauri
 * notification plugin posts real system notifications; tapping one brings
 * the app to the foreground (platform default).
 *
 * Known limitations (plugin exposes nothing else): `cancel` cannot remove a
 * posted notification by id, and a tap opens the app rather than the exact
 * item.
 */
export class ShellNotificationAdapter implements NotificationAdapter {
  private armed = false;

  constructor(private readonly notice: (text: string) => void = () => {}) {}

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
      sendNotification({
        id: notificationId(event.logical_key),
        title: item.title,
        body: item.detail ?? itemReminderSummary(item),
      });
    })();
  }

  cancel(): void {
    // No cancel-by-id in the plugin; posted notifications expire on their own.
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
  notice: (text: string) => void;
}): NotificationAdapter {
  return isTauri()
    ? new ShellNotificationAdapter(options.notice)
    : new BrowserNotificationAdapter(options.openItem, options.notice);
}
