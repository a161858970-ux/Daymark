import { check, type Update } from "@tauri-apps/plugin-updater";
import { invoke } from "@tauri-apps/api/core";
import { cacheDir, join } from "@tauri-apps/api/path";
import { isAndroid, isTauri } from "./apiBase.js";

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
    const dest = await join(await cacheDir(), "daymark-update.apk");
    await invoke("android_install_apk", {
      url: info.androidUrl,
      destPath: dest,
    });
    return;
  }
  throw new Error("没有可安装的更新");
}

/** Release the desktop plugin handle when the user declines. */
export function releaseUpdate(info: UpdateInfo | null): void {
  void info?.plugin?.close().catch(() => undefined);
}
