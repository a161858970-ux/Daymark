import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  isPermissionGranted,
  requestPermission,
} from "@tauri-apps/plugin-notification";
import { isAndroid } from "./apiBase.js";

/**
 * First-launch permission guide (Android only).
 *
 * Phone settings differ per OEM and nobody can be expected to find them,
 * so on first launch — together with the notification permission dialog,
 * which fires automatically while this card opens — every permission the
 * reminders need is listed here with a one-tap entry to its system page.
 * The system only shows one settings surface at a time, so the remaining
 * items are buttons instead of an auto-cascade (a stack of full-screen
 * intents would just bury each other).
 *
 * Shown exactly once: closing writes the localStorage flag and the card
 * never appears again. Renders null on desktop shells.
 */

export const PERMISSION_GUIDE_KEY = "daymark.permission-guide.shown";

/** Pure gate: Android shell AND first launch (flag not yet written). */
export function shouldShowPermissionGuide(
  android: boolean,
  alreadyShown: boolean,
): boolean {
  return android && !alreadyShown;
}

type NotifyState = "checking" | "granted" | "denied";

export function FirstLaunchGuide() {
  const [open, setOpen] = useState(() => {
    let shown: boolean;
    try {
      shown = localStorage.getItem(PERMISSION_GUIDE_KEY) !== null;
    } catch {
      shown = true; // storage unreadable → never nag
    }
    return shouldShowPermissionGuide(isAndroid(), shown);
  });
  const [notify, setNotify] = useState<NotifyState>("checking");

  // With the card opening, fire the notification permission dialog too —
  // one moment, all permission asks, then the user is done with settings.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void (async () => {
      try {
        let granted = await isPermissionGranted();
        if (!granted) {
          granted = (await requestPermission()) === "granted";
        }
        if (alive) setNotify(granted ? "granted" : "denied");
      } catch {
        if (alive) setNotify("denied");
      }
    })();
    return () => {
      alive = false;
    };
  }, [open]);

  if (!open) return null;

  function finish() {
    try {
      localStorage.setItem(PERMISSION_GUIDE_KEY, String(Date.now()));
    } catch {
      // storage unavailable — the gate already errs on the quiet side
    }
    setOpen(false);
  }

  async function openSetting(kind: "battery" | "exact_alarm" | "app_details") {
    try {
      await invoke("android_open_settings", { kind });
    } catch {
      // Some OEM builds rename these pages; the inline hint still tells
      // the user what to look for.
    }
  }

  const notifyLabel =
    notify === "granted"
      ? "已允许"
      : notify === "denied"
        ? "未允许"
        : "申请中…";

  return (
    <div
      className="permission-guide-backdrop"
      role="dialog"
      aria-label="首次启动权限引导"
    >
      <div className="permission-guide">
        <p className="permission-guide-title">让提醒准时找到你</p>
        <p className="permission-guide-subtitle">
          手机系统默认会拦截后台提醒，首次启动把下面几项打开即可，只此一次。
        </p>

        <div className="permission-guide-row">
          <span className="permission-guide-row-text">
            <strong>通知</strong>
            <small>上课提醒、到期提醒</small>
          </span>
          <span className={`permission-guide-state notify-${notify}`}>
            {notifyLabel}
          </span>
          {notify !== "granted" ? (
            <button
              type="button"
              className="permission-guide-action"
              onClick={() => {
                setNotify("checking");
                void requestPermission()
                  .then((result) =>
                    setNotify(result === "granted" ? "granted" : "denied"),
                  )
                  .catch(() => setNotify("denied"));
              }}
            >
              再次申请
            </button>
          ) : null}
        </div>

        <div className="permission-guide-row">
          <span className="permission-guide-row-text">
            <strong>别让系统杀掉提醒</strong>
            <small>电池设置里选“无限制 / 允许后台运行”</small>
          </span>
          <button
            type="button"
            className="permission-guide-action"
            onClick={() => void openSetting("battery")}
          >
            去设置
          </button>
        </div>

        <div className="permission-guide-row">
          <span className="permission-guide-row-text">
            <strong>到点就响（闹钟级）</strong>
            <small>允许“闹钟和提醒”</small>
          </span>
          <button
            type="button"
            className="permission-guide-action"
            onClick={() => void openSetting("exact_alarm")}
          >
            去设置
          </button>
        </div>

        <div className="permission-guide-row">
          <span className="permission-guide-row-text">
            <strong>自启动（小米等机型）</strong>
            <small>
              打开“自启动”，省电策略设为“无限制”；最近任务里下拉卡片加锁
            </small>
          </span>
          <button
            type="button"
            className="permission-guide-action"
            onClick={() => void openSetting("app_details")}
          >
            打开应用设置
          </button>
        </div>

        <p className="permission-guide-footnote">
          开关名称因品牌略有不同，含义一致即可。
        </p>

        <div className="permission-guide-actions">
          <button
            type="button"
            className="permission-guide-skip"
            onClick={finish}
          >
            跳过
          </button>
          <button
            type="button"
            className="permission-guide-done"
            onClick={finish}
          >
            完成，不再显示
          </button>
        </div>
      </div>
    </div>
  );
}
