import { useEffect, useRef, useState } from "react";
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

const labels: Record<AuthenticatedSyncState, string> = {
  LOCAL_ONLY: "仅本机",
  SIGNED_OUT: "连接同步",
  OFFLINE: "当前离线",
  SYNCING: "正在同步",
  UP_TO_DATE: "已同步",
  NEEDS_ATTENTION: "需要检查",
  ERROR: "稍后重试",
};

function checkedTime(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
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
  return (
    <div className={`sync-state-summary state-${state.toLowerCase()}`}>
      <span className="sync-status-dot" aria-hidden="true" />
      <div>
        <strong>{labels[state]}</strong>
        <small>
          {state === "LOCAL_ONLY"
            ? "记录保存在当前设备。"
            : state === "OFFLINE"
              ? "新记录会先保存在本机。"
              : state === "NEEDS_ATTENTION"
                ? `${attentionCount || 1} 条记录需要处理。`
                : state === "SYNCING"
                  ? "正在安静地核对更改。"
                  : state === "UP_TO_DATE"
                    ? `${lastChecked ? `${lastChecked} 核对` : "记录已核对"}。`
                    : state === "ERROR"
                      ? "本机记录安全保留，稍后可重试。"
                      : "登录后可在其他设备读取记录。"}
        </small>
        {state === "NEEDS_ATTENTION" && onOpenRepair && (
          <button
            type="button"
            className="sync-summary-action"
            onClick={onOpenRepair}
          >
            查看并处理 →
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
}: {
  online: boolean;
  status: AuthenticatedSyncStatus;
  attentionCount: number;
  /** Reveals the repair panel; the summary block is a status, so it needs an
   * explicit action to reach the retry/abandon exit (spec: ACTION_REQUIRED
   * must always have a way out). */
  onOpenRepair?: () => void;
}) {
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
    setMessage(redirectError);
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
  const lastChecked = checkedTime(status.checked_at);

  async function signOut() {
    setBusy(true);
    setMessage(null);
    try {
      await authAdapter!.signOut();
      setMessage("已退出账户。当前设备上的记录仍可查看。");
    } catch {
      setMessage("暂时无法退出账户，请稍后再试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="account-control" ref={rootRef}>
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
        <span>{labels[effectiveState]}</span>
        {attentionCount > 0 && (
          <b aria-label={`${attentionCount} 条需要检查`}>{attentionCount}</b>
        )}
      </button>
      {open && (
        <section
          className={`account-popover ${exiting ? "closing" : ""}`}
          aria-label="账户与同步"
        >
          <header>
            <div>
              <p className="eyebrow">ACCOUNT &amp; SYNC</p>
              <h2 ref={headingRef} tabIndex={-1}>
                账户与同步
              </h2>
            </div>
            <button
              type="button"
              className="detail-close"
              aria-label="关闭账户与同步"
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
            <p className="account-note">
              账户同步尚未启用；快速记录、课程与日程仍可离线使用。
            </p>
          ) : account ? (
            <>
              <p className="account-email">
                {account.email ?? account.phone ?? "已登录账户"}
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
                  立即核对
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void signOut()}
                >
                  退出账户
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
