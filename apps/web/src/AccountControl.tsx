import { useEffect, useRef, useState } from "react";
import { AiTaskProgress } from "./AiTaskProgress.js";
import type { AiTaskKind } from "./aiTaskStore.js";
import {
  authAdapter,
  authClient,
  retryAuthenticatedSync,
  type AuthenticatedSyncState,
  type AuthenticatedSyncStatus,
} from "./authSync.js";
import type { AuthAccount } from "./auth/adapter.js";
import {
  clearAuthRedirect,
  getStartupRedirectError,
  readAuthRedirectError,
} from "./auth/adapter.js";
import { AccountIdentities } from "./auth/AccountIdentities.js";
import { SignInPanel } from "./auth/SignInPanel.js";
import { motionDuration, useExitTransition } from "./motion.js";
import { useI18n, useT, type Translate } from "./i18n/index.js";

const stateKeys: Record<AuthenticatedSyncState, string> = {
  LOCAL_ONLY: "account.localOnly",
  SIGNED_OUT: "account.signedOut",
  OFFLINE: "account.offline",
  SYNCING: "account.syncing",
  UP_TO_DATE: "account.upToDate",
  NEEDS_ATTENTION: "account.needsAttention",
  ERROR: "account.error",
};

function stateDetail(
  t: Translate,
  state: AuthenticatedSyncState,
  attentionCount: number,
  lastChecked: string | null,
): string {
  if (state === "LOCAL_ONLY") return t("account.localOnlyDetail");
  if (state === "OFFLINE") return t("account.offlineDetail");
  if (state === "NEEDS_ATTENTION")
    return t("account.attentionDetail", { count: attentionCount || 1 });
  if (state === "SYNCING") return t("account.syncingDetail");
  if (state === "UP_TO_DATE")
    return lastChecked
      ? t("account.checkedAt", { time: lastChecked })
      : t("account.checked");
  if (state === "ERROR") return t("account.errorDetail");
  return t("account.signedOutDetail");
}

export function SyncStateSummary({
  state,
  attentionCount,
  lastChecked,
  onOpenRepair,
}: {
  state: AuthenticatedSyncState;
  attentionCount: number;
  lastChecked: string | null;
  onOpenRepair?: () => void;
}) {
  const t = useT();
  return (
    <div className={`sync-state-summary state-${state.toLowerCase()}`}>
      <span className="sync-status-dot" aria-hidden="true" />
      <div>
        <strong>{t(stateKeys[state])}</strong>
        <small>{stateDetail(t, state, attentionCount, lastChecked)}</small>
        {state === "NEEDS_ATTENTION" && onOpenRepair && (
          <button
            type="button"
            className="sync-summary-action"
            onClick={onOpenRepair}
          >
            {t("account.openRepair")}
          </button>
        )}
      </div>
    </div>
  );
}

export function AccountControl({
  online,
  status,
  attentionCount,
  onOpenRepair,
  onOpenCompletedTask,
}: {
  online: boolean;
  status: AuthenticatedSyncStatus;
  attentionCount: number;
  /** Sends the user to the page holding a finished AI task's result. */
  onOpenCompletedTask?: (kind: AiTaskKind) => void;
  /** Reveals the repair panel; the summary block is a status, so it needs an
   * explicit action to reach the retry/abandon exit (spec: ACTION_REQUIRED
   * must always have a way out). */
  onOpenRepair?: () => void;
}) {
  const t = useT();
  const { formatTime } = useI18n();
  const [open, setOpen] = useState(false);
  const [account, setAccount] = useState<AuthAccount | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const restoreFocusAfterCloseRef = useRef(false);
  const { exiting, beginExit, cancelExit } = useExitTransition(
    () => {
      setOpen(false);
      if (restoreFocusAfterCloseRef.current) buttonRef.current?.focus();
    },
    motionDuration.short,
    open ? "open" : "closed",
  );

  function closePopover(restoreFocus: boolean) {
    restoreFocusAfterCloseRef.current = restoreFocus;
    beginExit();
  }

  useEffect(() => {
    if (!authAdapter) return;
    let alive = true;
    void authAdapter.getAccount().then((value) => {
      if (alive) setAccount(value);
    });
    const listener = authAdapter.onAuthStateChange((value) => {
      if (alive) setAccount(value);
    });
    return () => {
      alive = false;
      listener.unsubscribe();
    };
  }, []);

  // OAuth / recovery returns may carry an error (e.g. linking an identity
  // that already belongs to another account): surface it once, then clean
  // the URL so a refresh cannot replay it.
  useEffect(() => {
    const redirectError =
      getStartupRedirectError() ??
      readAuthRedirectError(window.location.search);
    if (!redirectError) return;
    setMessage(t(redirectError));
    clearAuthRedirect();
    // The failure lands on a freshly loaded page (the panel is closed), so
    // open it — otherwise the user sees a silent reload.
    cancelExit();
    setOpen(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    headingRef.current?.focus();
    function closeOutside(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) closePopover(false);
    }
    function closeWithEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closePopover(true);
    }
    window.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", closeWithEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("keydown", closeWithEscape);
    };
  }, [open]);

  const effectiveState: AuthenticatedSyncState = !online
    ? "OFFLINE"
    : attentionCount > 0
      ? "NEEDS_ATTENTION"
      : status.state;
  const lastChecked = status.checked_at ? formatTime(status.checked_at) : null;

  async function signOut() {
    setBusy(true);
    setMessage(null);
    try {
      await authAdapter!.signOut();
      setMessage(t("account.signedOutToast"));
    } catch {
      setMessage(t("account.signOutFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="account-control" ref={rootRef}>
      <AiTaskProgress onOpen={(kind) => onOpenCompletedTask?.(kind)} />
      <button
        ref={buttonRef}
        type="button"
        className={`sync-status-trigger state-${effectiveState.toLowerCase()}`}
        aria-expanded={open}
        onClick={() => {
          if (open) closePopover(true);
          else {
            cancelExit();
            setOpen(true);
          }
        }}
      >
        <span className="sync-status-dot" aria-hidden="true" />
        <span>{t(stateKeys[effectiveState])}</span>
        {attentionCount > 0 && (
          <b aria-label={t("account.attentionAria", { count: attentionCount })}>
            {attentionCount}
          </b>
        )}
      </button>
      {open && (
        <section
          className={`account-popover ${exiting ? "closing" : ""}`}
          aria-label={t("account.title")}
        >
          <header>
            <div>
              <p className="eyebrow">{t("account.eyebrow")}</p>
              <h2 ref={headingRef} tabIndex={-1}>
                {t("account.title")}
              </h2>
            </div>
            <button
              type="button"
              className="detail-close"
              aria-label={t("account.closeTitle")}
              onClick={() => closePopover(true)}
            >
              ×
            </button>
          </header>
          <SyncStateSummary
            state={effectiveState}
            attentionCount={attentionCount}
            lastChecked={lastChecked}
            onOpenRepair={() => {
              onOpenRepair?.();
              closePopover(true);
            }}
          />
          {!authClient || !authAdapter ? (
            <p className="account-note">{t("account.syncUnavailable")}</p>
          ) : account ? (
            <>
              <p className="account-email">
                {account.email ?? account.phone ?? t("account.signedInAs")}
              </p>
              <AccountIdentities
                online={online}
                adapter={authAdapter}
                account={account}
              />
              <div className="account-actions">
                <button
                  type="button"
                  disabled={busy || !online}
                  onClick={retryAuthenticatedSync}
                >
                  {t("account.checkNow")}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void signOut()}
                >
                  {t("account.signOut")}
                </button>
              </div>
            </>
          ) : (
            <SignInPanel
              online={online}
              adapter={authAdapter}
              onSignedIn={(value) => setAccount(value)}
            />
          )}
          {message && <p role="status">{message}</p>}
        </section>
      )}
    </div>
  );
}
