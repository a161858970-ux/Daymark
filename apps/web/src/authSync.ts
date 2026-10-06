import { createClient } from "@supabase/supabase-js";
import { beginAiTask } from "./aiTaskStore.js";
import {
  conflictResolutionSchema,
  interpretationSchema,
  type CaptureInterpretation,
  type ConflictResolution,
} from "@course-manager/contracts";
import type { ActionRequiredSyncIssue } from "@course-manager/application";
import { OwnerBindingError } from "@course-manager/storage";
import { createSyncWorker, localRepository } from "./services.js";
import { HttpSyncTransport, type ConflictDetail } from "./syncTransport.js";
import { apiBase } from "./apiBase.js";
import {
  createAuthAdapter,
  type AuthAdapter,
  type AuthClientLike,
} from "./auth/adapter.js";

const authUrl = import.meta.env.VITE_SUPABASE_URL;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const authClient =
  authUrl && publishableKey ? createClient(authUrl, publishableKey) : null;

/**
 * Account / Authentication adapter (Auth V1): one account = one
 * auth.users.id with multiple linked identities. Email OTP is the email
 * sign-in path; magic-link remains only for recovery/verification emails.
 */
export const authAdapter: AuthAdapter | null = authClient
  ? createAuthAdapter(authClient.auth as unknown as AuthClientLike)
  : null;

/** Access token for background coordination (reminder claim/ack); null when signed out. */
export async function currentAccessToken(): Promise<string | null> {
  if (!authClient) return null;
  const { data, error } = await authClient.auth.getSession();
  if (error || !data.session) return null;
  return data.session.access_token;
}

export type { CaptureInterpretation } from "@course-manager/contracts";

export async function synchronizeAuthenticatedData(): Promise<string> {
  if (!authClient) throw new Error("请先配置账户同步，再导入课程表。");
  if (!navigator.onLine) throw new Error("当前离线；请联网后再导入课程表。");
  if (activeRun) await activeRun;
  const { data, error } = await authClient.auth.getSession();
  if (error || !data.session)
    throw error ?? new Error("请先登录账户，再导入课程表。");
  await localRepository.activateOwner(data.session.user.id);
  const token = data.session.access_token;
  const operation = createSyncWorker(async () => token).runOnce();
  activeRun = operation
    .then(
      () => undefined,
      () => undefined,
    )
    .finally(() => {
      activeRun = null;
    });
  const result = await operation;
  if (result.stopped)
    throw new Error("本机更改尚未同步完成；请先处理同步状态。");
  return token;
}

/** Explicit interpretation runs only after the locally saved RawCapture is synced. */
export async function requestCaptureInterpretation(
  captureId: string,
  currentCourseId: string | null,
  candidateCourseIds: string[],
): Promise<CaptureInterpretation> {
  if (!authClient) throw new Error("请先配置账户同步，再使用智能整理。");
  if (!navigator.onLine)
    throw new Error("当前离线；记录已保存在本机，可稍后整理。");
  const token = await synchronizeAuthenticatedData();
  // From here the backend waits on the model; the widget covers that window
  // even when the user switches views while the answer is still coming.
  const endAiTask = beginAiTask("capture");
  try {
    const result = await runCaptureInterpretation(
      token,
      captureId,
      currentCourseId,
      candidateCourseIds,
    );
    endAiTask("ok");
    return result;
  } catch (cause) {
    endAiTask("failed");
    throw cause;
  }
}

async function runCaptureInterpretation(
  token: string,
  captureId: string,
  currentCourseId: string | null,
  candidateCourseIds: string[],
): Promise<CaptureInterpretation> {
  const response = await fetch(
    `${apiBase()}/api/v1/ai/capture-interpretations`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        raw_capture_id: captureId,
        context: {
          candidate_course_ids: candidateCourseIds,
          current_course_id: currentCourseId,
          current_semester_id: null,
        },
      }),
    },
  );
  const body = (await response.json()) as {
    data?: { interpretation: CaptureInterpretation };
    error?: { message: string };
  };
  if (!response.ok || !body.data)
    throw new Error(
      body.error?.message ?? "智能整理暂时不可用；记录仍保存在本机。",
    );
  return interpretationSchema.parse(body.data.interpretation);
}

let activeRun: Promise<void> | null = null;
let actionRequired = false;
let retryRun: (() => void) | null = null;
/**
 * Sync cadence (engineering parameter, not product behaviour): the spec asks
 * only for "best effort while offline" and fixes no number. 5 s keeps a
 * second device visually live without meaningful request volume.
 * See docs/ADR-008-sync-cadence.md.
 */
export const SYNC_RECHECK_INTERVAL_MS = 5_000;

export type AuthenticatedSyncState =
  | "LOCAL_ONLY"
  | "SIGNED_OUT"
  | "OFFLINE"
  | "SYNCING"
  | "UP_TO_DATE"
  | "NEEDS_ATTENTION"
  | "ERROR";

export interface AuthenticatedSyncStatus {
  state: AuthenticatedSyncState;
  checked_at: string | null;
}

/**
 * Run the loop right after a local write instead of waiting for the next
 * tick, but only when there is actually something queued to push — a plain
 * UI refresh must not add a request.
 */
export function requestSyncNow(): void {
  if (!retryRun) return;
  void localRepository
    .pendingMutations()
    .then((pending) => {
      if (pending.length) retryRun?.();
    })
    .catch(() => undefined);
}

export function retryAuthenticatedSync(): void {
  actionRequired = false;
  retryRun?.();
}

export function openActionRequiredIssues(): Promise<ActionRequiredSyncIssue[]> {
  return localRepository.listActionRequiredIssues();
}

export async function retryActionRequiredIssue(
  mutationId: string,
): Promise<ActionRequiredSyncIssue[]> {
  if (activeRun) await activeRun;
  await localRepository.retryActionRequired(mutationId);
  actionRequired = false;
  retryRun?.();
  return localRepository.listActionRequiredIssues();
}

export async function abandonActionRequiredIssue(
  mutationId: string,
): Promise<ActionRequiredSyncIssue[]> {
  if (activeRun) await activeRun;
  await localRepository.abandonActionRequired(mutationId);
  actionRequired = false;
  retryRun?.();
  return localRepository.listActionRequiredIssues();
}

async function authenticatedTransport(): Promise<HttpSyncTransport | null> {
  if (!authClient) return null;
  const { data, error } = await authClient.auth.getSession();
  if (error) throw error;
  if (!data.session) return null;
  return new HttpSyncTransport(async () => data.session.access_token);
}

async function conflictDetails(
  transport: HttpSyncTransport,
): Promise<ConflictDetail[]> {
  const conflicts = await transport.conflicts();
  return Promise.all(conflicts.map((value) => transport.conflict(value.id)));
}

async function recoverResolvedConflicts(
  transport: HttpSyncTransport,
): Promise<void> {
  for (const mutation of await localRepository.pendingMutations()) {
    const id = /^VERSION_CONFLICT:([0-9a-f-]{36})$/.exec(
      mutation.last_error ?? "",
    )?.[1];
    if (!id) continue;
    const detail = await transport.conflict(id);
    if (detail.conflict.status === "RESOLVED")
      await localRepository.acceptResolvedConflict(
        detail.conflict,
        detail.current_entity,
      );
  }
}

export async function openSyncConflicts(): Promise<ConflictDetail[]> {
  const transport = await authenticatedTransport();
  return transport ? conflictDetails(transport) : [];
}

export async function resolveSyncConflict(
  id: string,
  observedVersion: number,
  resolution: ConflictResolution,
): Promise<{
  conflicts: ConflictDetail[];
  undo: { itemId: string; token: string } | null;
}> {
  if (activeRun) await activeRun;
  const operation = (async () => {
    const transport = await authenticatedTransport();
    if (!transport) throw new Error("请先登录账户，再处理同步冲突。");
    let resolved;
    try {
      resolved = await transport.resolveConflict(
        id,
        observedVersion,
        conflictResolutionSchema.parse(resolution),
      );
    } catch (cause) {
      // A server commit can succeed even if the response is lost. Read back
      // the resolved record before retrying a mutation with a new key.
      const detail = await transport.conflict(id).catch(() => null);
      if (detail?.conflict.status !== "RESOLVED") throw cause;
      resolved = {
        conflict: detail.conflict,
        entity: detail.current_entity,
      };
    }
    await localRepository.acceptResolvedConflict(
      resolved.conflict,
      resolved.entity,
      resolved.undo_token && resolved.undo_expires_at
        ? { token: resolved.undo_token, expiresAt: resolved.undo_expires_at }
        : undefined,
    );
    const result = await createSyncWorker(async () => {
      const { data, error } = await authClient!.auth.getSession();
      if (error || !data.session)
        throw error ?? new Error("Authentication required");
      return data.session.access_token;
    }).runOnce();
    actionRequired = result.stopped === "ACTION_REQUIRED";
    const remaining = await conflictDetails(transport);
    const deletedItem =
      resolved.conflict.entity_type === "ITEM"
        ? await localRepository.getItem(resolved.conflict.entity_id)
        : null;
    return {
      conflicts: remaining,
      undo:
        deletedItem?.deleted_at && resolved.undo_token
          ? { itemId: resolved.conflict.entity_id, token: resolved.undo_token }
          : null,
    };
  })();
  activeRun = operation
    .then(
      () => undefined,
      () => undefined,
    )
    .finally(() => {
      activeRun = null;
    });
  return operation;
}

/** Sync only after a valid session exists; local capture never waits for it. */
export function startAuthenticatedSync(
  onApplied: () => void,
  onAccountMismatch: () => void,
  onConflicts: (conflicts: ConflictDetail[]) => void,
  onNeedsAttention: (issues: ActionRequiredSyncIssue[]) => void,
  onStatus: (status: AuthenticatedSyncStatus) => void,
): () => void {
  if (!authClient) {
    onStatus({ state: "LOCAL_ONLY", checked_at: null });
    return () => {};
  }
  const client = authClient;
  let stopped = false;
  const publishStatus = (
    state: AuthenticatedSyncState,
    checkedAt: string | null = null,
  ) => {
    if (!stopped) onStatus({ state, checked_at: checkedAt });
  };
  const worker = createSyncWorker(async () => {
    const { data, error } = await client.auth.getSession();
    if (error || !data.session)
      throw error ?? new Error("Authentication required");
    return data.session.access_token;
  });
  const run = () => {
    if (stopped) return;
    if (!navigator.onLine) {
      publishStatus("OFFLINE");
      return;
    }
    if (activeRun) return;
    activeRun = (async () => {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      if (!data.session) {
        publishStatus("SIGNED_OUT");
        return;
      }
      publishStatus("SYNCING");
      const switched = await localRepository.activateOwner(
        data.session.user.id,
      );
      if (switched) onApplied();
      const transport = new HttpSyncTransport(
        async () => data.session.access_token,
      );
      await recoverResolvedConflicts(transport);
      const pendingConflict = (await localRepository.pendingMutations()).some(
        (value) => value.last_error?.startsWith("VERSION_CONFLICT:"),
      );
      if (pendingConflict) {
        if (!stopped) {
          onConflicts(await conflictDetails(transport));
          publishStatus("NEEDS_ATTENTION");
        }
        return;
      }
      if (actionRequired) {
        if (!stopped) {
          onNeedsAttention(await localRepository.listActionRequiredIssues());
          publishStatus("NEEDS_ATTENTION");
        }
        return;
      }
      const result = await worker.runOnce();
      if (result.stopped === "ACTION_REQUIRED") actionRequired = true;
      const issues = await localRepository.listActionRequiredIssues();
      if (!stopped) onNeedsAttention(issues);
      const conflicts = await conflictDetails(transport);
      if (!stopped) onConflicts(conflicts);
      if (!stopped && result.pulled > 0) onApplied();
      publishStatus(
        result.stopped || issues.length || conflicts.length
          ? "NEEDS_ATTENTION"
          : "UP_TO_DATE",
        new Date().toISOString(),
      );
    })()
      .catch((error: unknown) => {
        if (error instanceof OwnerBindingError) {
          actionRequired = true;
          if (!stopped) {
            onAccountMismatch();
            publishStatus("NEEDS_ATTENTION");
          }
        } else publishStatus("ERROR");
        // The persisted outbox remains available for the next network/session retry.
      })
      .finally(() => {
        activeRun = null;
      });
  };
  retryRun = run;
  const sessionListener = client.auth.onAuthStateChange((_event, session) => {
    if (session) {
      // A (re)authenticated session must re-diagnose why sync stopped: the
      // ACTION_REQUIRED flag raised while ANOTHER account was signed in would
      // otherwise keep this account blocked until the user presses retry by
      // hand. Genuinely rejected mutations re-assert the flag on the next run.
      actionRequired = false;
      publishStatus("SYNCING");
      window.setTimeout(run, 0);
    } else {
      actionRequired = false;
      onConflicts([]);
      onNeedsAttention([]);
      publishStatus("SIGNED_OUT");
    }
  });
  const markOffline = () => publishStatus("OFFLINE");
  const markVisible = () => {
    if (!document.hidden) run();
  };
  window.addEventListener("online", run);
  window.addEventListener("offline", markOffline);
  window.addEventListener("focus", run);
  document.addEventListener("visibilitychange", markVisible);
  const timer = window.setInterval(run, SYNC_RECHECK_INTERVAL_MS);
  run();
  return () => {
    stopped = true;
    if (retryRun === run) retryRun = null;
    sessionListener.data.subscription.unsubscribe();
    window.removeEventListener("online", run);
    window.removeEventListener("offline", markOffline);
    window.removeEventListener("focus", run);
    document.removeEventListener("visibilitychange", markVisible);
    window.clearInterval(timer);
  };
}
