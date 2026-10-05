/**
 * Process-wide state for AI requests the backend finishes on its own once
 * the upload has been accepted.
 *
 * The app never cancels a request (no AbortController anywhere) and the API
 * ignores client disconnects, so leaving the current view leaves the call in
 * flight; one widget in the shell reflects that, and when the wave settles
 * the finished task is remembered until the user clicks through to its page.
 */
export type AiTaskKind = "course-import" | "course-commit" | "capture";

/** Display/merge order for completed hints. */
const KIND_ORDER: AiTaskKind[] = ["course-import", "course-commit", "capture"];

type Listener = () => void;

export interface AiTaskSnapshot {
  active: number;
  /** Finished while nothing else is running; waits for the user's click. */
  completed: AiTaskKind[];
  /** Subset of `completed` whose request failed: the hint must not promise a result that was never produced. */
  failed: AiTaskKind[];
}

/** How a settled request ended — a failed import still needs the user's click, but the label tells the truth. */
export type AiTaskOutcome = "ok" | "failed";

const listeners = new Set<Listener>();
let active = 0;
let endedKinds = new Set<AiTaskKind>();
let failedKinds = new Set<AiTaskKind>();
let completed: AiTaskKind[] = [];
let snapshot: AiTaskSnapshot = { active: 0, completed: [], failed: [] };

const kindOrder = (a: AiTaskKind, b: AiTaskKind): number =>
  KIND_ORDER.indexOf(a) - KIND_ORDER.indexOf(b);

function commit(): void {
  snapshot = {
    active,
    completed: [...completed],
    failed: [...failedKinds]
      .filter((kind) => completed.includes(kind))
      .sort(kindOrder),
  };
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
export function beginAiTask(
  kind: AiTaskKind,
): (outcome: AiTaskOutcome) => void {
  active += 1;
  endedKinds = new Set();
  failedKinds = new Set();
  completed = [];
  commit();
  let ended = false;
  return (outcome) => {
    if (ended) return;
    ended = true;
    active = Math.max(0, active - 1);
    endedKinds.add(kind);
    if (outcome === "failed") failedKinds.add(kind);
    // Completion is only announced once every task of the wave has settled;
    // the order is fixed (import first) so the hint never flips between
    // renders just because Set iteration follows end order.
    if (active === 0) completed = [...endedKinds].sort(kindOrder);
    commit();
  };
}

/** The user clicked through: the hint has done its job. */
export function dismissCompletedAiTasks(): void {
  if (!completed.length && endedKinds.size === 0) return;
  completed = [];
  endedKinds = new Set();
  failedKinds = new Set();
  commit();
}
