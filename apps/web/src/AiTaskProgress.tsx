import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getAiTaskCount, subscribeAiTasks } from "./aiTaskStore.js";

/**
 * Placeholder progress for backend AI work (课表识别 / 智能整理).
 *
 * Deliberately indeterminate: the backend exposes no real percentage, so this
 * never prints a number and never claims a completion value — the bar only
 * says "a background process is running", switches to a full bar when the
 * request settles, and retires itself.
 */
export function AiTaskProgress() {
  const count = useSyncExternalStore(
    subscribeAiTasks,
    getAiTaskCount,
    getAiTaskCount,
  );
  const active = count > 0;
  const wasActive = useRef(false);
  const [finishing, setFinishing] = useState(false);

  useEffect(() => {
    if (active) {
      wasActive.current = true;
      setFinishing(false);
      return;
    }
    // Only a task that actually ran may push the bar to 100 %.
    if (!wasActive.current) return;
    wasActive.current = false;
    setFinishing(true);
    const retire = setTimeout(() => setFinishing(false), 1400);
    return () => clearTimeout(retire);
  }, [active]);

  const phase = active ? "running" : finishing ? "finishing" : "idle";
  if (phase === "idle") return null;

  return (
    <div
      className={`ai-task-progress phase-${phase}`}
      role="status"
      aria-live="polite"
      data-phase={phase}
      data-active-tasks={count}
    >
      <p className="ai-task-progress-label">
        {phase === "running"
          ? "AI 正在后台处理，可以先去别的页面"
          : "后台处理完成，回来看看结果"}
      </p>
      <div className="ai-task-progress-track" aria-hidden="true">
        <span className="ai-task-progress-bar bar-one" />
        <span className="ai-task-progress-bar bar-two" />
      </div>
    </div>
  );
}
