import { check, type Update } from "@tauri-apps/plugin-updater";
import { invoke } from "@tauri-apps/api/core";
import { sendNotification } from "@tauri-apps/plugin-notification";
import { cacheDir, join } from "@tauri-apps/api/path";
import { isAndroid, isTauri } from "./apiBase.js";
import { getMessage } from "./i18n/messages/index.js";
import { readStoredLocale } from "./i18n/locale.js";

/**
 * Update check with a platform split:
 *
 * - **Desktop** uses the official updater plugin (signature-verified,
 *   silent NSIS install, auto-restart).
 * - **Android** cannot: the plugin's mobile `install_inner` is a literal
 *   no-op in tauri-plugin-updater 2.13.2. So the shell fetches the same
 *   `latest.json` manifest itself, compares semver locally and downloads
 *   the APK through the `android_install_apk` Rust command, which hands it
 *   to the system package installer (FileProvider URI).
 *
 * Both paths read the same manifest hosted at api.daymark.top.
 */

const MANIFEST_URL = "https://api.daymark.top/update/latest.json";

export interface UpdateInfo {
  version: string;
  body?: string | null;
  /** Android: installer URL from the manifest. */
  androidUrl?: string;
  /** Desktop: plugin handle, kept until install/dismiss (Rust-side resource). */
  plugin?: Update;
}

/** Strict greater-than semver compare on numeric dot segments. */
export function isNewerVersion(candidate: string, current: string): boolean {
  const parse = (value: string) =>
    value
      .replace(/^v/, "")
      .split(".")
      .map((part) => Number.parseInt(part, 10) || 0);
  const a = parse(candidate);
  const b = parse(current);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const left = a[index] ?? 0;
    const right = b[index] ?? 0;
    if (left !== right) return left > right;
  }
  return false;
}

export async function checkForUpdate(
  currentVersion: string,
): Promise<UpdateInfo | null> {
  if (!isTauri()) return null;
  if (isAndroid()) {
    const response = await fetch(MANIFEST_URL, { cache: "no-store" });
    if (!response.ok) return null;
    const manifest = (await response.json()) as {
      version?: string;
      notes?: string;
      platforms?: Record<string, { url?: string } | undefined>;
    };
    const platform =
      manifest.platforms?.["android-aarch64"] ??
      manifest.platforms?.["android-armv7"] ??
      manifest.platforms?.["android"];
    if (
      !manifest.version ||
      !platform?.url ||
      !isNewerVersion(manifest.version, currentVersion)
    ) {
      return null;
    }
    return {
      version: manifest.version,
      body: manifest.notes ?? null,
      androidUrl: platform.url,
    };
  }
  // Desktop: the plugin already compares versions (null when not newer).
  const update = await check();
  if (!update) return null;
  return { version: update.version, body: update.body ?? null, plugin: update };
}

export async function installUpdate(info: UpdateInfo): Promise<void> {
  if (info.plugin) {
    await info.plugin.downloadAndInstall(undefined, {
      restartAfterInstall: true,
    });
    return;
  }
  if (info.androidUrl) {
    // Android: hand the download to the SYSTEM DownloadManager — progress
    // shows in the notification shade, the download survives the app
    // being backgrounded, and the update card can close immediately so
    // the user keeps working. Completion posts a tappable notification
    // ("下载完成，点按安装") which routes to the system installer.
    try {
      const started = await invoke<{ id: string }>("android_start_update", {
        url: info.androidUrl,
        fileName: UPDATE_APK_NAME,
      });
      void watchUpdateDownload(started.id);
      return;
    } catch {
      // DownloadManager rejected the request (OEM/path quirks) → fall
      // back to the direct download-and-install flow so an update can
      // never deadlock behind a downloader failure.
      const dest = await join(await cacheDir(), UPDATE_APK_NAME);
      await invoke("android_install_apk", {
        url: info.androidUrl,
        destPath: dest,
      });
      return;
    }
  }
  throw new Error("No installable update");
}

/** Localized copy for shell notifications (outside React). */
function notice(key: string, params?: Record<string, string | number>): string {
  return getMessage(readStoredLocale(), key, params);
}

/** Release the desktop plugin handle when the user declines. */
export function releaseUpdate(info: UpdateInfo | null): void {
  void info?.plugin?.close().catch(() => undefined);
}

/** Canonical cache file name — must match DaymarkSettingsPlugin's default
 *  so the "download complete" notification tap finds the package even
 *  after the app process restarted. */
const UPDATE_APK_NAME = "daymark-update.apk";

/** Watch the system download in the background; ~10 min budget (1.5 s cadence). */
async function watchUpdateDownload(id: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    try {
      const state = await invoke<{
        status: string;
        expectedBytes?: number;
        fileBytes?: number;
      }>("android_query_update", { id });
      if (state.status === "done") {
        // Truncated download must never be announced as ready.
        if (
          typeof state.expectedBytes === "number" &&
          typeof state.fileBytes === "number" &&
          state.expectedBytes > 0 &&
          state.fileBytes < state.expectedBytes
        ) {
          await announceUpdateFailed();
          return;
        }
        await announceUpdateReady();
        return;
      }
      if (state.status === "failed") {
        await announceUpdateFailed();
        return;
      }
    } catch {
      // transient IPC error — keep polling
    }
  }
}

async function announceUpdateFailed(): Promise<void> {
  try {
    await sendNotification({
      title: notice("sync.notifyUpdateTitle"),
      body: notice("sync.notifyUpdateFailedBody"),
      extra: { kind: "update_failed" },
    });
  } catch {
    // best effort
  }
}

/** Marker key: set while a finished update package waits to be installed. */
export const UPDATE_READY_KEY = "daymark.update-ready";

async function announceUpdateReady(): Promise<void> {
  // Durable marker: however the notification ends up (tap failing, user
  // dismissing), the next foreground/launch surfaces an in-app dialog so a
  // finished download can never become unreachable.
  try {
    localStorage.setItem(UPDATE_READY_KEY, UPDATE_APK_NAME);
  } catch {
    // storage unavailable — the notification path still works
  }
  const foreground =
    typeof document !== "undefined" && document.visibilityState === "visible";
  if (foreground) {
    window.dispatchEvent(new CustomEvent("daymark-update-ready"));
    return;
  }
  try {
    await sendNotification({
      title: notice("sync.notifyUpdateReadyTitle"),
      body: notice("sync.notifyUpdateReadyBody"),
      extra: { kind: "update_install" },
    });
  } catch {
    // notification denied → in-app dialog appears on next open
  }
}

/**
 * Fire the installer for the ready package and clear the marker. Errors
 * surface as an error notification instead of dying silently (the old
 * `.catch(() => undefined)` hid real failures).
 */
export async function openReadyUpdate(): Promise<void> {
  try {
    await invoke("android_install_update");
    try {
      localStorage.removeItem(UPDATE_READY_KEY);
    } catch {
      // ignore
    }
  } catch (cause) {
    try {
      await sendNotification({
        title: notice("sync.notifyUpdateTitle"),
        body: notice("sync.notifyInstallFailedBody", {
          error: cause instanceof Error ? cause.message : String(cause),
        }),
        extra: { kind: "update_failed" },
      });
    } catch {
      // ignore
    }
  }
}
