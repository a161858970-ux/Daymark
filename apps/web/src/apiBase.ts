/**
 * Absolute origin of the Daymark API.
 *
 * In the packaged (Tauri) app relative URLs would hit the shell's own
 * origin, so the production cloud address is baked in; everywhere else
 * (dev server, tests) "" keeps requests on the same origin and the vite
 * proxy keeps working unchanged.
 */
/** True inside the packaged Tauri shell (browser builds never match). */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** True on the Android shell (wry's WebView always says so in its UA). */
export function isAndroid(): boolean {
  return (
    typeof navigator !== "undefined" && /android/i.test(navigator.userAgent)
  );
}

export function apiBase(): string {
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window)
    return "https://api.daymark.top";
  return import.meta.env.VITE_API_BASE_URL ?? "";
}
