/**
 * Absolute origin of the Daymark API.
 *
 * In the packaged (Tauri) app relative URLs would hit the shell's own
 * origin, so the production cloud address is baked in; everywhere else
 * (dev server, tests) "" keeps requests on the same origin and the vite
 * proxy keeps working unchanged.
 */
export function apiBase(): string {
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window)
    return "https://api.daymark.top";
  return import.meta.env.VITE_API_BASE_URL ?? "";
}
