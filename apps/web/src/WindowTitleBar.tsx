import { useEffect, useState, type MouseEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isAndroid, isTauri } from "./apiBase.js";

/**
 * Packaged-shell chrome. The OS window frame is removed
 * (tauri.conf.json decorations: false), so this strip owns moving the
 * window, double-click maximize and the three window buttons. It also
 * flags body.tauri-shell so the layout shifts down below it. In the
 * browser build it renders nothing at all.
 */
export default function WindowTitleBar() {
  const [enabled] = useState(() => isTauri() && !isAndroid());
  useEffect(() => {
    if (!enabled) return;
    document.body.classList.add("tauri-shell");
    return () => document.body.classList.remove("tauri-shell");
  }, [enabled]);
  if (!enabled) return null;
  const win = getCurrentWindow();
  const fromControl = (event: { target: EventTarget | null }) =>
    (event.target as HTMLElement).closest("button") !== null;
  const onStripDown = (event: MouseEvent<HTMLDivElement>) => {
    // detail > 1 = the second click of a double-click: let maximize win.
    if (event.button !== 0 || event.detail > 1 || fromControl(event)) return;
    void win.startDragging();
  };
  const onStripDouble = (event: MouseEvent<HTMLDivElement>) => {
    if (fromControl(event)) return;
    void win.toggleMaximize();
  };
  return (
    <div
      className="window-titlebar"
      role="toolbar"
      aria-label="窗口控制"
      onMouseDown={onStripDown}
      onDoubleClick={onStripDouble}
    >
      <div className="titlebar-label">
        <img src="/daymark-icon.png" alt="" />
        <span>拾序</span>
      </div>
      <div className="window-controls">
        <button
          type="button"
          aria-label="最小化"
          onClick={() => void win.minimize()}
        >
          <svg viewBox="0 0 11 11" aria-hidden="true">
            <path d="M0 5.5h11" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>
        <button
          type="button"
          aria-label="最大化"
          onClick={() => void win.toggleMaximize()}
        >
          <svg viewBox="0 0 11 11" aria-hidden="true">
            <rect
              x="0.5"
              y="0.5"
              width="10"
              height="10"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
            />
          </svg>
        </button>
        <button
          type="button"
          aria-label="关闭"
          className="window-control-close"
          onClick={() => void win.close()}
        >
          <svg viewBox="0 0 11 11" aria-hidden="true">
            <path
              d="M0 0l11 11M11 0L0 11"
              stroke="currentColor"
              strokeWidth="1"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
