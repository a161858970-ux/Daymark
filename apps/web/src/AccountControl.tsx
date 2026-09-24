import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  authClient,
  retryAuthenticatedSync,
  sendSignInLink,
  type AuthenticatedSyncState,
  type AuthenticatedSyncStatus,
} from "./authSync.js";

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

export function AccountControl({
  online,
  status,
  attentionCount,
}: {
  online: boolean;
  status: AuthenticatedSyncStatus;
  attentionCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [signedInEmail, setSignedInEmail] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!authClient) return;
    let alive = true;
    void authClient.auth.getSession().then(({ data }) => {
      if (alive) setSignedInEmail(data.session?.user.email ?? null);
    });
    const listener = authClient.auth.onAuthStateChange((_event, session) => {
      if (alive) setSignedInEmail(session?.user.email ?? null);
    });
    return () => {
      alive = false;
      listener.data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    headingRef.current?.focus();
    function closeOutside(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function closeWithEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
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

  async function sendLink(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await sendSignInLink(email.trim());
      setMessage("登录链接已发送。当前记录仍保存在本机。");
    } catch {
      setMessage("暂时无法发送登录链接，请稍后再试。");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    setMessage(null);
    try {
      const { error } = await authClient!.auth.signOut();
      if (error) throw error;
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
        onClick={() => setOpen((value) => !value)}
      >
        <span className="sync-status-dot" aria-hidden="true" />
        <span>{labels[effectiveState]}</span>
        {attentionCount > 0 && (
          <b aria-label={`${attentionCount} 条需要检查`}>{attentionCount}</b>
        )}
      </button>
      {open && (
        <section className="account-popover" aria-label="账户与同步">
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
              onClick={() => {
                setOpen(false);
                buttonRef.current?.focus();
              }}
            >
              ×
            </button>
          </header>
          <div
            className={`sync-state-summary state-${effectiveState.toLowerCase()}`}
          >
            <span className="sync-status-dot" aria-hidden="true" />
            <div>
              <strong>{labels[effectiveState]}</strong>
              <small>
                {effectiveState === "LOCAL_ONLY"
                  ? "记录保存在当前设备。"
                  : effectiveState === "OFFLINE"
                    ? "新记录会先保存在本机。"
                    : effectiveState === "NEEDS_ATTENTION"
                      ? `${attentionCount || 1} 条记录需要处理。`
                      : effectiveState === "SYNCING"
                        ? "正在安静地核对更改。"
                        : effectiveState === "UP_TO_DATE"
                          ? `${lastChecked ? `${lastChecked} 核对` : "记录已核对"}。`
                          : effectiveState === "ERROR"
                            ? "本机记录安全保留，稍后可重试。"
                            : "登录后可在其他设备读取记录。"}
              </small>
            </div>
          </div>
          {!authClient ? (
            <p className="account-note">
              账户同步尚未启用；快速记录、课程与日程仍可离线使用。
            </p>
          ) : signedInEmail ? (
            <>
              <p className="account-email">{signedInEmail}</p>
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
                  className="quiet-button"
                  disabled={busy}
                  onClick={() => void signOut()}
                >
                  退出账户
                </button>
              </div>
            </>
          ) : (
            <form onSubmit={(event) => void sendLink(event)}>
              <label htmlFor="sync-email">邮箱</label>
              <input
                id="sync-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
              <button type="submit" disabled={busy || !online}>
                {busy ? "正在发送…" : "发送登录链接"}
              </button>
            </form>
          )}
          {message && <p role="status">{message}</p>}
        </section>
      )}
    </div>
  );
}
