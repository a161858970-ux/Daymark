import { useCallback, useEffect, useRef, useState } from "react";

export const motionDuration = {
  fast: 120,
  short: 180,
  medium: 240,
  panel: 280,
  slow: 360,
  feedback: 2200,
  completionHold: 180,
} as const;

export function effectiveMotionDuration(
  duration: number,
  reducedMotion: boolean,
) {
  return reducedMotion ? 0 : duration;
}

function reducedMotionRequested() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function useExitTransition(
  onExited: () => void,
  duration: number,
  resetKey?: string,
) {
  const [exiting, setExiting] = useState(false);
  const exitingRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const onExitedRef = useRef(onExited);
  onExitedRef.current = onExited;

  const cancelExit = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    exitingRef.current = false;
    setExiting(false);
  }, []);

  const beginExit = useCallback(() => {
    if (exitingRef.current) return;
    exitingRef.current = true;
    setExiting(true);
    const delay = effectiveMotionDuration(duration, reducedMotionRequested());
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      exitingRef.current = false;
      setExiting(false);
      onExitedRef.current();
    }, delay);
  }, [duration]);

  useEffect(() => {
    cancelExit();
  }, [cancelExit, resetKey]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  return { exiting, beginExit, cancelExit };
}
