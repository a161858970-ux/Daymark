import { useEffect, useState, type FormEvent } from "react";
import {
  authClient,
  retryAuthenticatedSync,
  sendSignInLink,
} from "./authSync.js";

export function AccountControl() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [signedInEmail, setSignedInEmail] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  if (!authClient) return null;

  async function sendLink(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await sendSignInLink(email.trim());
      setMessage("登录链接已发送，请在邮箱中打开。当前记录仍保存在本机。");
    } catch (cause) {
      setMessage(`未能发送登录链接：${String(cause)}`);
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
    } catch (cause) {
      setMessage(`退出失败：${String(cause)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="account-control">
      <button
        type="button"
        className="quiet-button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {signedInEmail ? "账户" : "连接同步"}
      </button>
      {open && (
        <section className="account-popover" aria-label="账户同步">
          <h2>账户同步</h2>
          {signedInEmail ? (
            <>
              <p>{signedInEmail}</p>
              <button type="button" onClick={retryAuthenticatedSync}>
                重试同步
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void signOut()}
              >
                退出账户
              </button>
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
              <button type="submit" disabled={busy}>
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
