/**
 * Contract with the Android shell (MainActivity.kt): Android's back button
 * asks `window.__daymarkBack()` what to do.
 *
 * Returns `true` when an in-page overlay consumed the press — we close it
 * through the same Escape path every overlay already listens for, so layers
 * peel one at a time (detail → list, dropdown → detail, …).
 *
 * Returns `false` at the root page so the shell can move the task to the
 * background instead of finishing the activity.
 */

const OPEN_OVERLAYS = [
  ".detail-panel",
  ".account-popover",
  ".search-surface",
  ".calendar-view.day-open",
  ".select-panel",
  ".datetime-panel",
  ".quick-capture.expanded",
];

function visible(element: Element): boolean {
  const style = getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden") return false;
  if (Number(style.opacity) <= 0) return false;
  return element.getClientRects().length > 0;
}

declare global {
  interface Window {
    __daymarkBack?: () => boolean;
  }
}

export function installBackButton(): void {
  if (typeof window === "undefined") return;
  window.__daymarkBack = () => {
    const open = OPEN_OVERLAYS.some((selector) =>
      Array.from(document.querySelectorAll(selector)).some(visible),
    );
    if (!open) return false;
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    return true;
  };
}
