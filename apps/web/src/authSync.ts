import { createClient } from "@supabase/supabase-js";
import {
  conflictResolutionSchema,
  interpretationSchema,
  type CaptureInterpretation,
  type ConflictResolution,
} from "@course-manager/contracts";
import { OwnerBindingError } from "@course-manager/storage";
import { createSyncWorker, localRepository } from "./services.js";
import { HttpSyncTransport, type ConflictDetail } from "./syncTransport.js";

const authUrl = import.meta.env.VITE_SUPABASE_URL;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const authClient =
  authUrl && publishableKey ? createClient(authUrl, publishableKey) : null;

/** The account UI can use this without changing the capture or domain paths. */
export async function sendSignInLink(email: string): Promise<void> {
  if (!authClient) throw new Error("Account sync is not configured");
  const { error } = await authClient.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin },
  });
  if (error) throw error;
}

export type { CaptureInterpretation } from "@course-manager/contracts";

/** Explicit interpretation runs only after the locally saved RawCapture is synced. */
export async function requestCaptureInterpretation(
  captureId: string,
  currentCourseId: string | null,
  candidateCourseIds: string[],
): Promise<CaptureInterpretation> {
  if (!authClient) throw new Error("请先配置账户同步，再使用智能整理。");
  if (!navigator.onLine)
    throw new Error("当前离线；记录已保存在本机，可稍后整理。");
  const { data, error } = await authClient.auth.getSession();
  if (error || !data.session) throw new Error("请先登录账户，再使用智能整理。");
  const token = data.session.access_token;
  if (activeRun) await activeRun;
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
  if (result.stopped) throw new Error("记录尚未同步完成；请稍后重试。");
  const response = await fetch("/api/v1/ai/capture-interpretations", {
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
  });
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
const SYNC_RECHECK_INTERVAL_MS = 30_000;

export function retryAuthenticatedSync(): void {
  actionRequired = false;
  retryRun?.();
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
  onNeedsAttention: () => void,
): () => void {
  if (!authClient) return () => {};
  const client = authClient;
  let stopped = false;
  const worker = createSyncWorker(async () => {
    const { data, error } = await client.auth.getSession();
    if (error || !data.session)
      throw error ?? new Error("Authentication required");
    return data.session.access_token;
  });
  const run = () => {
    if (stopped || !navigator.onLine || activeRun) return;
    activeRun = (async () => {
      const { data } = await client.auth.getSession();
      if (!data.session) return;
      const transport = new HttpSyncTransport(
        async () => data.session.access_token,
      );
      await recoverResolvedConflicts(transport);
      const pendingConflict = (await localRepository.pendingMutations()).some(
        (value) => value.last_error?.startsWith("VERSION_CONFLICT:"),
      );
      if (pendingConflict) {
        if (!stopped) onConflicts(await conflictDetails(transport));
        return;
      }
      if (actionRequired) return;
      const result = await worker.runOnce();
      if (result.stopped === "ACTION_REQUIRED") actionRequired = true;
      if (result.stopped === "ACTION_REQUIRED" && !stopped) onNeedsAttention();
      const conflicts = await conflictDetails(transport);
      if (!stopped) onConflicts(conflicts);
      if (!stopped && result.pulled > 0) onApplied();
    })()
      .catch((error: unknown) => {
        if (error instanceof OwnerBindingError) {
          actionRequired = true;
          if (!stopped) onAccountMismatch();
        }
        // The persisted outbox remains available for the next network/session retry.
      })
      .finally(() => {
        activeRun = null;
      });
  };
  retryRun = run;
  const sessionListener = client.auth.onAuthStateChange((_event, session) => {
    if (session) window.setTimeout(run, 0);
    else {
      actionRequired = false;
      onConflicts([]);
    }
  });
  window.addEventListener("online", run);
  window.addEventListener("focus", run);
  const timer = window.setInterval(run, SYNC_RECHECK_INTERVAL_MS);
  run();
  return () => {
    stopped = true;
    if (retryRun === run) retryRun = null;
    sessionListener.data.subscription.unsubscribe();
    window.removeEventListener("online", run);
    window.removeEventListener("focus", run);
    window.clearInterval(timer);
  };
}
