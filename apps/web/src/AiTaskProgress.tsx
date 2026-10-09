import { useSyncExternalStore } from "react";
import {
  dismissCompletedAiTasks,
  getAiTaskSnapshot,
  subscribeAiTasks,
  type AiTaskKind,
} from "./aiTaskStore.js";
import { useT } from "./i18n/index.js";

const completedKeys: Record<AiTaskKind, string> = {
  "course-import": "sync.ai.importDone",
  "course-commit": "sync.ai.commitDone",
  capture: "sync.ai.captureDone",
};

/** A failed wave still needs the click-through — the panel there shows why it failed. */
const failedKeys: Record<AiTaskKind, string> = {
  "course-import": "sync.ai.importFailed",
  "course-commit": "sync.ai.commitFailed",
  capture: "sync.ai.captureFailed",
};

/** Import results matter more, so when a wave mixed kinds it wins the hint. */
function pickCompleted(completed: AiTaskKind[]): AiTaskKind {
  return completed.includes("course-import") ? "course-import" : completed[0]!;
}

/**
 * Placeholder for backend AI work (课表识别 / 智能整理).
 *
 * Deliberately indeterminate: the backend exposes no real percentage, so the
 * bar never prints a number and loops before the end. Once the wave settles
 * the widget does not vanish — it stays as a clickable hint until the user
 * opens the page that holds the result.
 */
export function AiTaskProgress({ onOpen }: { onOpen(kind: AiTaskKind): void }) {
  const t = useT();
  const { active, completed, failed } = useSyncExternalStore(
    subscribeAiTasks,
    getAiTaskSnapshot,
    getAiTaskSnapshot,
  );

  if (active > 0) {
    return (
      <div
        className="ai-task-progress phase-running"
        role="status"
        aria-live="polite"
        data-phase="running"
        data-active-tasks={active}
      >
        <p className="ai-task-progress-label">{t("sync.aiRunning")}</p>
        <div className="ai-task-progress-track" aria-hidden="true">
          <span className="ai-task-progress-bar bar-one" />
          <span className="ai-task-progress-bar bar-two" />
        </div>
      </div>
    );
  }

  if (completed.length > 0) {
    const kind = pickCompleted(completed);
    const didFail = failed.includes(kind);
    const phase = didFail ? "failed" : "completed";
    return (
      <button
        type="button"
        className={`ai-task-progress phase-${phase}`}
        data-phase={phase}
        data-kind={kind}
        onClick={() => {
          dismissCompletedAiTasks();
          onOpen(kind);
        }}
      >
        <span className="ai-task-progress-label">
          {t(didFail ? failedKeys[kind] : completedKeys[kind])}
        </span>
        <span className="ai-task-progress-track" aria-hidden="true">
          <span className="ai-task-progress-bar bar-one" />
        </span>
      </button>
    );
  }

  return null;
}
