/**
 * Which import job is currently being committed, as module state.
 *
 * The commit request keeps running server-side when the user navigates
 * away (nothing in the app cancels a request), but the panel's local
 * `loading` state dies with unmount — returning mid-commit used to show
 * the review buttons again, as if nothing were happening. This store lets
 * a remounted panel keep displaying "正在建立课程…" until the commit it
 * started settles, regardless of which page the user visited meanwhile.
 */

type Listener = () => void;

const listeners = new Set<Listener>();
let committingJobId: string | null = null;
let snapshot: string | null = null;

function commit(): void {
  snapshot = committingJobId;
  for (const listener of [...listeners]) listener();
}

export function subscribeCourseCommit(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getCommittingJobId(): string | null {
  return snapshot;
}

export function beginCourseCommit(jobId: string): void {
  committingJobId = jobId;
  commit();
}

/** Idempotent; a stale end for another job never clears the current one. */
export function endCourseCommit(jobId: string): void {
  if (committingJobId !== jobId) return;
  committingJobId = null;
  commit();
}
