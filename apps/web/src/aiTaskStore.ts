/**
 * Process-wide state for AI requests the backend finishes on its own once
 * the upload has been accepted.
 *
 * The app never cancels a request (no AbortController anywhere) and the API
 * ignores client disconnects, so leaving the current view leaves the call in
 * flight; one widget in the shell reflects that, and when the wave settles
 * the finished task is remembered until the user clicks through to its page.
 */
export type AiTaskKind = "course-import" | "capture";

/** Display/merge order for completed hints. */
const KIND_ORDER: AiTaskKind[] = ["course-import", "capture"];

type Listener = () => void;

export interface AiTaskSnapshot {
  active: number;
  /** Finished while nothing else is running; waits for the user's click. */
  completed: AiTaskKind[];
}

const listeners = new Set<Listener>();
let active = 0;
let endedKinds = new Set<AiTaskKind>();
let completed: AiTaskKind[] = [];
let snapshot: AiTaskSnapshot = { active: 0, completed: [] };

function commit(): void {
  snapshot = { active, completed: [...completed] };
  for (const listener of [...listeners]) listener();
}

export function subscribeAiTasks(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getAiTaskSnapshot(): AiTaskSnapshot {
  return snapshot;
}

/**
 * Marks one AI request as in flight and returns an idempotent end handle;
 * call it in a `finally` so a failed upload still settles the counter.
 */
export function beginAiTask(kind: AiTaskKind): () => void {
  active += 1;
  endedKinds = new Set();
  completed = [];
  commit();
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    active = Math.max(0, active - 1);
    endedKinds.add(kind);
    // Completion is only announced once every task of the wave has settled;
    // the order is fixed (import first) so the hint never flips between
    // renders just because Set iteration follows end order.
    if (active === 0)
      completed = [...endedKinds].sort(
        (a, b) => KIND_ORDER.indexOf(a) - KIND_ORDER.indexOf(b),
      );
    commit();
  };
}

/** The user clicked through: the hint has done its job. */
export function dismissCompletedAiTasks(): void {
  if (!completed.length && endedKinds.size === 0) return;
  completed = [];
  endedKinds = new Set();
  commit();
}
