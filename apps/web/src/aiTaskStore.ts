/**
 * Process-wide counter for AI requests that the backend keeps running on its
 * own once the upload has been accepted.
 *
 * The app never cancels a request (there is no AbortController anywhere), so
 * leaving the current view or switching browser tabs leaves the call in
 * flight; this store lets one small progress widget anywhere in the shell
 * reflect that truth, instead of every screen owning its own spinner.
 */
type Listener = () => void;

const listeners = new Set<Listener>();
let active = 0;

function emit(): void {
  for (const listener of [...listeners]) listener();
}

export function subscribeAiTasks(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getAiTaskCount(): number {
  return active;
}

/**
 * Marks one AI request as in flight and returns an idempotent end handle;
 * call it in a `finally` so a failed upload still settles the counter.
 */
export function beginAiTask(): () => void {
  active += 1;
  emit();
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    active = Math.max(0, active - 1);
    emit();
  };
}
