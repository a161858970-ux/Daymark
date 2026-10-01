import { useEffect } from "react";
import { motionDuration, useExitTransition } from "./motion.js";

export interface FeedbackNotice {
  id: number;
  message: string;
  action?: () => Promise<void>;
  duration: number;
}

export function TransientFeedback({
  feedback,
  onDismiss,
  onError,
}: {
  feedback: FeedbackNotice;
  onDismiss(): void;
  onError(cause: unknown): void;
}) {
  const { exiting, beginExit } = useExitTransition(
    onDismiss,
    motionDuration.short,
    String(feedback.id),
  );

  useEffect(() => {
    const visibleFor = Math.max(0, feedback.duration - motionDuration.short);
    const timer = window.setTimeout(beginExit, visibleFor);
    return () => window.clearTimeout(timer);
  }, [beginExit, feedback.duration, feedback.id]);

  return (
    <div className={`feedback ${exiting ? "closing" : ""}`} role="status">
      <span>{feedback.message}</span>
      {feedback.action && (
        <button
          type="button"
          onClick={() => {
            const action = feedback.action;
            beginExit();
            void action?.().catch(onError);
          }}
        >
          撤销
        </button>
      )}
    </div>
  );
}

export function ErrorNotice({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss(): void;
}) {
  const { exiting, beginExit } = useExitTransition(
    onDismiss,
    motionDuration.short,
    message,
  );
  return (
    <div className={`error-banner ${exiting ? "closing" : ""}`} role="alert">
      <span>{message}</span>
      <button
        type="button"
        className="detail-close"
        aria-label="关闭错误"
        onClick={beginExit}
      >
        ×
      </button>
    </div>
  );
}
