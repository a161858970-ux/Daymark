import { useState } from "react";

/**
 * Update card. Platform strategy (official plugin on desktop, custom APK
 * install on Android) lives in updateService; this component only drives
 * the confirm/cancel/progress UI.
 */
export function UpdateDialog({
  version,
  body,
  install,
  onDismiss,
}: {
  version: string;
  body?: string | null;
  install: () => Promise<void>;
  onDismiss: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      await install();
      // Desktop restarts into the new build; Android shows the system
      // installer sheet — if we return, close the card ourselves.
      onDismiss();
    } catch (cause) {
      setBusy(false);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <div className="update-dialog" role="dialog" aria-label="应用更新">
      <p className="update-dialog-title">发现新版本 v{version}</p>
      {body ? <p className="update-dialog-notes">{body}</p> : null}
      {error ? <p className="update-dialog-error">更新失败：{error}</p> : null}
      <div className="update-dialog-actions">
        <button type="button" onClick={onDismiss} disabled={busy}>
          稍后
        </button>
        <button
          type="button"
          className="primary"
          onClick={() => void run()}
          disabled={busy}
        >
          {busy ? "下载安装中…" : "立即更新"}
        </button>
      </div>
    </div>
  );
}
