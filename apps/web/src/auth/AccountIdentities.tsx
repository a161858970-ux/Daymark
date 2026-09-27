import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  DEFAULT_PHONE_COUNTRY,
  PHONE_COUNTRIES,
  formatPhoneDisplay,
  normalizePhone,
} from "./phone.js";
import type { AuthAccount, AuthIdentityView, AuthAdapter } from "./adapter.js";
import { AuthUiError } from "./errors.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type RowForm = "phone" | "phone-code" | "email" | "email-code" | "password";

/**
 * Account page section: 登录方式 (identities + credentials).
 *
 * Every action here operates on the signed-in Supabase user only. Nothing
 * touches business data, because owner stays `auth.users.id` no matter which
 * identity the user authenticates with.
 */
export function AccountIdentities({
  online,
  adapter,
  account,
}: {
  online: boolean;
  adapter: AuthAdapter | null;
  account: AuthAccount | null;
}) {
  const [identities, setIdentities] = useState<AuthIdentityView[]>([]);
  const [form, setForm] = useState<RowForm | null>(null);
  const [countryCode, setCountryCode] = useState(DEFAULT_PHONE_COUNTRY);
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!adapter) return;
    try {
      setIdentities(await adapter.listIdentities());
    } catch {
      /* listing failures are surfaced on the next action */
    }
  }, [adapter]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!adapter || !account) return null;

  const phoneIdentity = identities.find((value) => value.provider === "phone");
  const emailIdentity = identities.find((value) => value.provider === "email");
  const googleIdentity = identities.find(
    (value) => value.provider === "google",
  );
  const passwordSet = adapter.passwordStatus(account.userId) === "SET";
  const unlinkAllowed = adapter.canUnlink(identities);

  function fail(error: unknown) {
    setIsError(true);
    setMessage(
      error instanceof AuthUiError ? error.message : "操作未成功，请稍后再试。",
    );
  }

  function succeed(text: string) {
    setIsError(false);
    setMessage(text);
  }

  async function run(operation: () => Promise<void>, success: string) {
    setBusy(true);
    try {
      await operation();
      succeed(success);
      return true;
    } catch (error) {
      fail(error);
      return false;
    } finally {
      setBusy(false);
    }
  }

  function closeForm() {
    setForm(null);
    setCode("");
    setPassword("");
    setPhone("");
  }

  function submitBindPhone(event: FormEvent) {
    event.preventDefault();
    const normalized = normalizePhone(phone, countryCode);
    if (!normalized) {
      setIsError(true);
      setMessage("请输入有效的手机号。");
      return;
    }
    void (async () => {
      const sent = await run(
        () => adapter!.linkPhone(normalized),
        "验证码已发送；输入后即可绑定该手机号。",
      );
      if (sent) {
        setPhone(normalized);
        setForm("phone-code");
        setCode("");
      }
    })();
  }

  function submitVerifyPhone(event: FormEvent) {
    event.preventDefault();
    void (async () => {
      const done = await run(
        () => adapter!.verifyLinkPhone(phone, code.trim()),
        "手机号已绑定。",
      );
      if (done) {
        await refresh();
        closeForm();
      }
    })();
  }

  function submitBindEmail(event: FormEvent) {
    event.preventDefault();
    const value = email.trim();
    if (!EMAIL_PATTERN.test(value)) {
      setIsError(true);
      setMessage("请输入有效的邮箱地址。");
      return;
    }
    void (async () => {
      const sent = await run(
        () => adapter!.linkEmail(value),
        "验证码已发送；输入后即可绑定该邮箱。",
      );
      if (sent) {
        setForm("email-code");
        setCode("");
      }
    })();
  }

  function submitVerifyEmail(event: FormEvent) {
    event.preventDefault();
    void (async () => {
      const done = await run(
        () => adapter!.verifyLinkEmail(email.trim(), code.trim()),
        "邮箱已绑定。",
      );
      if (done) {
        await refresh();
        closeForm();
      }
    })();
  }

  function submitPassword(event: FormEvent) {
    event.preventDefault();
    void (async () => {
      const done = await run(
        () => adapter!.setPassword(password),
        "密码已设置。",
      );
      if (done) closeForm();
    })();
  }

  function unlink(provider: string) {
    void (async () => {
      const done = await run(() => adapter!.unlink(provider), "已解除绑定。");
      if (done) await refresh();
    })();
  }

  const bindButton = (target: RowForm, text: string) => (
    <button
      type="button"
      disabled={busy || !online}
      onClick={() => {
        setForm(target);
        setMessage(null);
      }}
    >
      {text}
    </button>
  );

  const unlinkButton = (provider: string, bound: boolean) =>
    bound && (
      <button
        type="button"
        className="quiet-button"
        disabled={busy || !unlinkAllowed}
        title={
          unlinkAllowed
            ? "解除绑定"
            : "至少保留一种登录方式，无法解除最后的绑定"
        }
        onClick={() => unlink(provider)}
      >
        解除绑定
      </button>
    );

  return (
    <div className="identity-list">
      <p className="eyebrow">登录方式</p>

      <section className="identity-row">
        <div>
          <strong>手机号</strong>
          <small>
            {phoneIdentity
              ? `${formatPhoneDisplay(phoneIdentity.label ?? account.phone ?? "")} · ${phoneIdentity.verified ? "已验证" : "未验证"}`
              : "未绑定"}
          </small>
        </div>
        <div className="identity-actions">
          {!phoneIdentity && bindButton("phone", "绑定手机号")}
          {phoneIdentity &&
            !phoneIdentity.verified &&
            bindButton("phone", "完成验证")}
          {unlinkButton("phone", Boolean(phoneIdentity))}
        </div>
        {form === "phone" && (
          <form onSubmit={submitBindPhone}>
            <label htmlFor="identity-country">国家 / 地区</label>
            <select
              id="identity-country"
              value={countryCode}
              onChange={(event) => setCountryCode(event.target.value)}
            >
              {PHONE_COUNTRIES.map((country) => (
                <option key={country.code} value={country.code}>
                  {country.label} {country.code}
                </option>
              ))}
            </select>
            <label htmlFor="identity-phone">手机号</label>
            <input
              id="identity-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel-national"
              required
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
            <div className="identity-form-actions">
              <button type="submit" disabled={busy || !online}>
                {busy ? "正在发送…" : "发送验证码"}
              </button>
              <button
                type="button"
                className="quiet-button"
                onClick={closeForm}
              >
                取消
              </button>
            </div>
          </form>
        )}
        {form === "phone-code" && (
          <form onSubmit={submitVerifyPhone}>
            <label htmlFor="identity-phone-code">短信验证码</label>
            <input
              id="identity-phone-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={8}
              required
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
            <div className="identity-form-actions">
              <button type="submit" disabled={busy || !online || !code}>
                {busy ? "正在验证…" : "确认绑定"}
              </button>
              <button
                type="button"
                className="quiet-button"
                onClick={closeForm}
              >
                取消
              </button>
            </div>
          </form>
        )}
      </section>

      <section className="identity-row">
        <div>
          <strong>邮箱</strong>
          <small>
            {emailIdentity
              ? `${emailIdentity.label ?? account.email ?? ""} · ${emailIdentity.verified ? "已验证" : "未验证"}`
              : "未绑定"}
          </small>
        </div>
        <div className="identity-actions">
          {!emailIdentity && bindButton("email", "绑定邮箱")}
          {emailIdentity &&
            !emailIdentity.verified &&
            bindButton("email", "完成验证")}
          {unlinkButton("email", Boolean(emailIdentity))}
        </div>
        {form === "email" && (
          <form onSubmit={submitBindEmail}>
            <label htmlFor="identity-email">邮箱</label>
            <input
              id="identity-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <div className="identity-form-actions">
              <button type="submit" disabled={busy || !online}>
                {busy ? "正在发送…" : "发送验证码"}
              </button>
              <button
                type="button"
                className="quiet-button"
                onClick={closeForm}
              >
                取消
              </button>
            </div>
          </form>
        )}
        {form === "email-code" && (
          <form onSubmit={submitVerifyEmail}>
            <label htmlFor="identity-email-code">邮箱验证码</label>
            <input
              id="identity-email-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={8}
              required
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
            <div className="identity-form-actions">
              <button type="submit" disabled={busy || !online || !code}>
                {busy ? "正在验证…" : "确认绑定"}
              </button>
              <button
                type="button"
                className="quiet-button"
                onClick={closeForm}
              >
                取消
              </button>
            </div>
          </form>
        )}
      </section>

      <section className="identity-row">
        <div>
          <strong>Google</strong>
          <small>{googleIdentity ? "已绑定" : "未绑定"}</small>
        </div>
        <div className="identity-actions">
          {!googleIdentity && (
            <button
              type="button"
              disabled={busy || !online}
              onClick={() =>
                void run(() => adapter!.linkGoogle(), "正在前往 Google…")
              }
            >
              绑定 Google
            </button>
          )}
          {unlinkButton("google", Boolean(googleIdentity))}
        </div>
      </section>

      <section className="identity-row">
        <div>
          <strong>密码</strong>
          <small>{passwordSet ? "已设置" : "未设置（本机判断）"}</small>
        </div>
        <div className="identity-actions">
          <button
            type="button"
            disabled={busy || !online}
            onClick={() => {
              setForm("password");
              setMessage(null);
            }}
          >
            {passwordSet ? "修改密码" : "设置密码"}
          </button>
          <button
            type="button"
            className="quiet-button"
            disabled={busy || !online || !account.email}
            onClick={() =>
              void run(
                () => adapter!.requestPasswordReset(account.email ?? ""),
                "重置邮件已发送；按邮件指引即可设置新密码。",
              )
            }
          >
            忘记密码
          </button>
        </div>
        {form === "password" && (
          <form onSubmit={submitPassword}>
            <label htmlFor="identity-password">
              {passwordSet ? "新密码" : "密码"}
            </label>
            <input
              id="identity-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <div className="identity-form-actions">
              <button type="submit" disabled={busy || !online}>
                {busy ? "正在保存…" : "保存"}
              </button>
              <button
                type="button"
                className="quiet-button"
                onClick={closeForm}
              >
                取消
              </button>
            </div>
          </form>
        )}
      </section>

      {message && (
        <p
          role="status"
          aria-live="polite"
          className={isError ? "auth-error" : undefined}
        >
          {message}
        </p>
      )}
    </div>
  );
}
