import { useEffect, useRef, useState, type FormEvent } from "react";
import { DEFAULT_PHONE_COUNTRY, normalizePhone } from "./phone.js";
import type { AuthAccount, AuthAdapter } from "./adapter.js";
import { AuthUiError } from "./errors.js";
import { isTauri } from "../apiBase.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESEND_COUNTDOWN_MS = 60_000;

type Channel = "phone" | "email";
type PhoneStep = "number" | "code";
type EmailStep = "code-entry" | null;
type CredentialMode = "otp" | "password";
type PasswordAction = "sign_in" | "sign_up" | "reset";

/**
 * Sign-in surface. Priority follows the frozen product decision:
 * PRIMARY 手机号+验证码 → SECONDARY Google → TERTIARY 邮箱（验证码 / 密码）.
 */
export function SignInPanel({
  online,
  adapter,
  onSignedIn,
}: {
  online: boolean;
  adapter: AuthAdapter | null;
  onSignedIn?: (account: AuthAccount) => void;
}) {
  const [channel, setChannel] = useState<Channel>("phone");
  const [phoneStep, setPhoneStep] = useState<PhoneStep>("number");
  const [emailStep, setEmailStep] = useState<EmailStep>(null);
  const [credentialMode, setCredentialMode] = useState<CredentialMode>("otp");
  const [passwordAction, setPasswordAction] =
    useState<PasswordAction>("sign_in");
  const [resetSent, setResetSent] = useState(false);

  // Product decision (2026-09-28): China-only phone login - no country
  // picker and no visible +86 prefix; normalization still emits E.164.
  const countryCode = DEFAULT_PHONE_COUNTRY;
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");

  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resendAt, setResendAt] = useState<number | null>(null);
  const [, setTick] = useState(0);
  const timerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
    },
    [],
  );

  if (!adapter) {
    return (
      <p className="account-note">
        账户登录尚未启用；快速记录、课程与日程仍可离线使用。
      </p>
    );
  }

  function fail(error: unknown) {
    setIsError(true);
    setMessage(
      error instanceof AuthUiError
        ? error.message
        : "登录暂时不可用，请稍后再试。",
    );
  }

  function succeed(text: string) {
    setIsError(false);
    setMessage(text);
  }

  function startResendCountdown() {
    const deadline = Date.now() + RESEND_COUNTDOWN_MS;
    setResendAt(deadline);
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    timerRef.current = window.setInterval(() => {
      if (Date.now() >= deadline) {
        if (timerRef.current !== null) window.clearInterval(timerRef.current);
        timerRef.current = null;
        setResendAt(null);
      }
      setTick((value) => value + 1);
    }, 1000);
  }

  const resending = resendAt !== null && resendAt > Date.now();

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

  async function signedIn(
    operation: () => Promise<AuthAccount>,
    success: string,
  ) {
    const ok = await run(async () => {
      onSignedIn?.(await operation());
    }, success);
    if (ok) {
      setCode("");
      setPassword("");
    }
  }

  function submitPhoneNumber(event: FormEvent) {
    event.preventDefault();
    const normalized = normalizePhone(phone, countryCode);
    if (!normalized) {
      setIsError(true);
      setMessage("请输入有效的手机号。");
      return;
    }
    void (async () => {
      const sent = await run(
        () => adapter!.sendPhoneOtp(normalized),
        "验证码已发送到你的手机。",
      );
      if (sent) {
        setPhoneStep("code");
        setCode("");
        startResendCountdown();
      }
    })();
  }

  function submitPhoneCode(event: FormEvent) {
    event.preventDefault();
    const normalized = normalizePhone(phone, countryCode);
    if (!normalized) return;
    void signedIn(
      () => adapter!.verifyPhoneOtp(normalized, code.trim()),
      "已登录。",
    );
  }

  function submitPhonePassword(event: FormEvent) {
    event.preventDefault();
    const normalized = normalizePhone(phone, countryCode);
    if (!normalized) {
      setIsError(true);
      setMessage("请输入有效的手机号。");
      return;
    }
    void (async () => {
      if (passwordAction === "sign_up")
        await signedIn(
          () => adapter!.signUpPhonePassword(normalized, password),
          "账户已创建并登录。",
        );
      else
        await signedIn(
          () => adapter!.signInPhonePassword(normalized, password),
          "已登录。",
        );
    })();
  }

  function submitEmailOtp(event: FormEvent) {
    event.preventDefault();
    const value = email.trim();
    if (!EMAIL_PATTERN.test(value)) {
      setIsError(true);
      setMessage("请输入有效的邮箱地址。");
      return;
    }
    void (async () => {
      const sent = await run(
        () => adapter!.sendEmailOtp(value),
        "验证码已发送到你的邮箱。",
      );
      if (sent) {
        setEmailStep("code-entry");
        setCode("");
        startResendCountdown();
      }
    })();
  }

  function submitEmailCode(event: FormEvent) {
    event.preventDefault();
    void signedIn(
      () => adapter!.verifyEmailOtp(email.trim(), code.trim()),
      "已登录。",
    );
  }

  function submitRecovery(event: FormEvent) {
    event.preventDefault();
    void signedIn(
      () => adapter!.completePasswordRecovery(email.trim(), code.trim()),
      "身份已验证；请在登录方式中设置新密码。",
    );
  }

  function submitEmailPassword(event: FormEvent) {
    event.preventDefault();
    const value = email.trim();
    if (!EMAIL_PATTERN.test(value)) {
      setIsError(true);
      setMessage("请输入有效的邮箱地址。");
      return;
    }
    if (passwordAction === "reset") {
      void (async () => {
        const sent = await run(
          () => adapter!.requestPasswordReset(value),
          "重置邮件已发送；请输入邮件中的验证码。",
        );
        if (sent) {
          setResetSent(true);
          setCode("");
        }
      })();
      return;
    }
    void (async () => {
      if (passwordAction === "sign_up")
        await signedIn(
          () => adapter!.signUpEmailPassword(value, password),
          "账户已创建并登录。",
        );
      else
        await signedIn(
          () => adapter!.signInEmailPassword(value, password),
          "已登录。",
        );
    })();
  }

  function resend() {
    if (resending || busy) return;
    if (channel === "phone") {
      const normalized = normalizePhone(phone, countryCode);
      if (!normalized) return;
      void run(
        () => adapter!.sendPhoneOtp(normalized),
        "验证码已重新发送。",
      ).then((sent) => sent && startResendCountdown());
    } else {
      void run(
        () => adapter!.sendEmailOtp(email.trim()),
        "验证码已重新发送。",
      ).then((sent) => sent && startResendCountdown());
    }
  }

  const codeField = (
    <label htmlFor="auth-code">
      验证码
      <input
        id="auth-code"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={8}
        required
        value={code}
        onChange={(event) => setCode(event.target.value)}
      />
    </label>
  );

  const resendButton = (
    <button
      type="button"
      className="quiet-button"
      disabled={busy || resending || !online}
      onClick={resend}
    >
      {resending ? "稍后可重发" : "重新发送验证码"}
    </button>
  );

  const passwordField = (
    <label htmlFor="auth-password">
      密码
      <input
        id="auth-password"
        type="password"
        autoComplete={
          passwordAction === "sign_up" ? "new-password" : "current-password"
        }
        required
        minLength={8}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
    </label>
  );

  const channelSwitch =
    channel === "phone" ? (
      <button
        type="button"
        className="quiet-button"
        onClick={() => {
          setChannel("email");
          setEmailStep(null);
          setCredentialMode("otp");
          setMessage(null);
        }}
      >
        使用邮箱登录
      </button>
    ) : (
      <button
        type="button"
        className="quiet-button"
        onClick={() => {
          setChannel("phone");
          setPhoneStep("number");
          setMessage(null);
        }}
      >
        使用手机号登录
      </button>
    );

  return (
    <div className="auth-panel">
      {channel === "phone" ? (
        credentialMode === "otp" ? (
          phoneStep === "number" ? (
            <form onSubmit={submitPhoneNumber}>
              <label htmlFor="auth-phone">手机号</label>
              <input
                id="auth-phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel-national"
                placeholder="11 位手机号"
                required
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
              />
              <button type="submit" disabled={busy || !online}>
                {busy ? "正在发送…" : "获取验证码"}
              </button>
            </form>
          ) : (
            <form onSubmit={submitPhoneCode}>
              {codeField}
              <div className="auth-actions">
                <button type="submit" disabled={busy || !online || !code}>
                  {busy ? "正在登录…" : "登录"}
                </button>
                {resendButton}
              </div>
              <button
                type="button"
                className="quiet-button"
                onClick={() => {
                  setPhoneStep("number");
                  setMessage(null);
                }}
              >
                换一个手机号
              </button>
            </form>
          )
        ) : (
          <form
            onSubmit={
              passwordAction === "reset"
                ? submitEmailPassword
                : submitPhonePassword
            }
          >
            {passwordField}
            <div className="auth-actions">
              <button type="submit" disabled={busy || !online}>
                {busy
                  ? "正在处理…"
                  : passwordAction === "sign_up"
                    ? "创建账户并登录"
                    : "登录"}
              </button>
              <button
                type="button"
                className="quiet-button"
                onClick={() =>
                  setPasswordAction(
                    passwordAction === "sign_in" ? "sign_up" : "sign_in",
                  )
                }
              >
                {passwordAction === "sign_in" ? "创建账户" : "已有账户，登录"}
              </button>
            </div>
          </form>
        )
      ) : emailStep === "code-entry" ? (
        <form onSubmit={submitEmailCode}>
          <p className="account-note">验证码已发送至 {email.trim()}</p>
          {codeField}
          <div className="auth-actions">
            <button type="submit" disabled={busy || !online || !code}>
              {busy ? "正在登录…" : "登录"}
            </button>
            {resendButton}
          </div>
          <button
            type="button"
            className="quiet-button"
            onClick={() => {
              setEmailStep(null);
              setMessage(null);
            }}
          >
            换一个邮箱
          </button>
        </form>
      ) : credentialMode === "otp" ? (
        <form onSubmit={submitEmailOtp}>
          <label htmlFor="auth-email">邮箱</label>
          <input
            id="auth-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <button type="submit" disabled={busy || !online}>
            {busy ? "正在发送…" : "发送邮箱验证码"}
          </button>
        </form>
      ) : passwordAction === "reset" && resetSent ? (
        <form onSubmit={submitRecovery}>
          <p className="account-note">验证码已发送至 {email.trim()}</p>
          {codeField}
          <div className="auth-actions">
            <button type="submit" disabled={busy || !online || !code}>
              {busy ? "正在验证…" : "完成验证"}
            </button>
            <button
              type="button"
              className="quiet-button"
              onClick={() => {
                setResetSent(false);
                setMessage(null);
              }}
            >
              重新发送
            </button>
          </div>
        </form>
      ) : (
        <form onSubmit={submitEmailPassword}>
          <label htmlFor="auth-email">邮箱</label>
          <input
            id="auth-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          {passwordAction !== "reset" && passwordField}
          <div className="auth-actions">
            <button type="submit" disabled={busy || !online}>
              {busy
                ? "正在处理…"
                : passwordAction === "reset"
                  ? "发送重置邮件"
                  : passwordAction === "sign_up"
                    ? "创建账户并登录"
                    : "登录"}
            </button>
            <button
              type="button"
              className="quiet-button"
              onClick={() =>
                setPasswordAction(
                  passwordAction === "sign_in"
                    ? "sign_up"
                    : passwordAction === "sign_up"
                      ? "reset"
                      : "sign_in",
                )
              }
            >
              {passwordAction === "sign_in"
                ? "创建账户"
                : passwordAction === "sign_up"
                  ? "忘记密码"
                  : "返回登录"}
            </button>
          </div>
        </form>
      )}

      <div className="auth-secondary">
        <button
          type="button"
          className="google-sign-in"
          disabled={busy || !online || isTauri()}
          onClick={() =>
            void run(() => adapter.signInGoogle(), "正在前往 Google…")
          }
        >
          {isTauri() ? "Google 登录（桌面版暂不可用）" : "使用 Google 登录"}
        </button>
        {channelSwitch}
        {channel === "email" && (
          <button
            type="button"
            className="quiet-button"
            onClick={() => {
              setCredentialMode(credentialMode === "otp" ? "password" : "otp");
              setPasswordAction("sign_in");
              setEmailStep(null);
              setMessage(null);
            }}
          >
            {credentialMode === "otp"
              ? "使用邮箱密码登录"
              : "使用邮箱验证码登录"}
          </button>
        )}
        {channel === "phone" && credentialMode === "otp" && (
          <button
            type="button"
            className="quiet-button"
            onClick={() => {
              setCredentialMode("password");
              setMessage(null);
            }}
          >
            使用手机号密码登录
          </button>
        )}
        {channel === "phone" && credentialMode === "password" && (
          <button
            type="button"
            className="quiet-button"
            onClick={() => {
              setCredentialMode("otp");
              setPasswordAction("sign_in");
              setMessage(null);
            }}
          >
            使用手机号验证码登录
          </button>
        )}
      </div>

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
