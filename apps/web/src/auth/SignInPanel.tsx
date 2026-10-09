import { useEffect, useRef, useState, type FormEvent } from "react";
import { DEFAULT_PHONE_COUNTRY, normalizePhone } from "./phone.js";
import type { AuthAccount, AuthAdapter } from "./adapter.js";
import { AuthUiError } from "./errors.js";
import { useT } from "../i18n/index.js";

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
  const t = useT();
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
    return <p className="account-note">{t("auth.signInUnavailable")}</p>;
  }

  function fail(error: unknown) {
    setIsError(true);
    setMessage(
      error instanceof AuthUiError
        ? t(error.messageKey)
        : t("auth.signInFailed"),
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
      setMessage(t("auth.invalidPhone"));
      return;
    }
    void (async () => {
      const sent = await run(
        () => adapter!.sendPhoneOtp(normalized),
        t("auth.otpSentPhone"),
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
      t("auth.signedIn"),
    );
  }

  function submitPhonePassword(event: FormEvent) {
    event.preventDefault();
    const normalized = normalizePhone(phone, countryCode);
    if (!normalized) {
      setIsError(true);
      setMessage(t("auth.invalidPhone"));
      return;
    }
    void (async () => {
      if (passwordAction === "sign_up")
        await signedIn(
          () => adapter!.signUpPhonePassword(normalized, password),
          t("auth.accountCreated"),
        );
      else
        await signedIn(
          () => adapter!.signInPhonePassword(normalized, password),
          t("auth.signedIn"),
        );
    })();
  }

  function submitEmailOtp(event: FormEvent) {
    event.preventDefault();
    const value = email.trim();
    if (!EMAIL_PATTERN.test(value)) {
      setIsError(true);
      setMessage(t("auth.invalidEmail"));
      return;
    }
    void (async () => {
      const sent = await run(
        () => adapter!.sendEmailOtp(value),
        t("auth.otpSentEmail"),
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
      t("auth.signedIn"),
    );
  }

  function submitRecovery(event: FormEvent) {
    event.preventDefault();
    void signedIn(
      () => adapter!.completePasswordRecovery(email.trim(), code.trim()),
      t("auth.recoveryVerified"),
    );
  }

  function submitEmailPassword(event: FormEvent) {
    event.preventDefault();
    const value = email.trim();
    if (!EMAIL_PATTERN.test(value)) {
      setIsError(true);
      setMessage(t("auth.invalidEmail"));
      return;
    }
    if (passwordAction === "reset") {
      void (async () => {
        const sent = await run(
          () => adapter!.requestPasswordReset(value),
          t("auth.resetSent"),
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
          t("auth.accountCreated"),
        );
      else
        await signedIn(
          () => adapter!.signInEmailPassword(value, password),
          t("auth.signedIn"),
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
        t("auth.otpResent"),
      ).then((sent) => sent && startResendCountdown());
    } else {
      void run(
        () => adapter!.sendEmailOtp(email.trim()),
        t("auth.otpResent"),
      ).then((sent) => sent && startResendCountdown());
    }
  }

  const codeField = (
    <label htmlFor="auth-code">
      {t("auth.codeLabel")}
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
      {resending ? t("auth.resendLater") : t("auth.resendCode")}
    </button>
  );

  const passwordField = (
    <label htmlFor="auth-password">
      {t("auth.passwordLabel")}
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
        {t("auth.useEmail")}
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
        {t("auth.usePhone")}
      </button>
    );

  return (
    <div className="auth-panel">
      {channel === "phone" ? (
        credentialMode === "otp" ? (
          phoneStep === "number" ? (
            <form onSubmit={submitPhoneNumber}>
              <label htmlFor="auth-phone">{t("auth.phoneLabel")}</label>
              <input
                id="auth-phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel-national"
                placeholder={t("auth.phonePlaceholder")}
                required
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
              />
              <button type="submit" disabled={busy || !online}>
                {busy ? t("auth.sending") : t("auth.getCode")}
              </button>
            </form>
          ) : (
            <form onSubmit={submitPhoneCode}>
              {codeField}
              <div className="auth-actions">
                <button type="submit" disabled={busy || !online || !code}>
                  {busy ? t("auth.signingIn") : t("auth.signIn")}
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
                {t("auth.changePhone")}
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
                  ? t("common.processing")
                  : passwordAction === "sign_up"
                    ? t("auth.createAndSignIn")
                    : t("auth.signIn")}
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
                {passwordAction === "sign_in"
                  ? t("auth.createAccount")
                  : t("auth.haveAccountSignIn")}
              </button>
            </div>
          </form>
        )
      ) : emailStep === "code-entry" ? (
        <form onSubmit={submitEmailCode}>
          <p className="account-note">
            {t("auth.otpSentTo", { email: email.trim() })}
          </p>
          {codeField}
          <div className="auth-actions">
            <button type="submit" disabled={busy || !online || !code}>
              {busy ? t("auth.signingIn") : t("auth.signIn")}
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
            {t("auth.changeEmail")}
          </button>
        </form>
      ) : credentialMode === "otp" ? (
        <form onSubmit={submitEmailOtp}>
          <label htmlFor="auth-email">{t("auth.emailLabel")}</label>
          <input
            id="auth-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <button type="submit" disabled={busy || !online}>
            {busy ? t("auth.sending") : t("auth.sendEmailCode")}
          </button>
        </form>
      ) : passwordAction === "reset" && resetSent ? (
        <form onSubmit={submitRecovery}>
          <p className="account-note">
            {t("auth.otpSentTo", { email: email.trim() })}
          </p>
          {codeField}
          <div className="auth-actions">
            <button type="submit" disabled={busy || !online || !code}>
              {busy ? t("auth.verifying") : t("auth.completeVerification")}
            </button>
            <button
              type="button"
              className="quiet-button"
              onClick={() => {
                setResetSent(false);
                setMessage(null);
              }}
            >
              {t("auth.resend")}
            </button>
          </div>
        </form>
      ) : (
        <form onSubmit={submitEmailPassword}>
          <label htmlFor="auth-email">{t("auth.emailLabel")}</label>
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
                ? t("common.processing")
                : passwordAction === "reset"
                  ? t("auth.sendResetEmail")
                  : passwordAction === "sign_up"
                    ? t("auth.createAndSignIn")
                    : t("auth.signIn")}
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
                ? t("auth.createAccount")
                : passwordAction === "sign_up"
                  ? t("auth.forgotPassword")
                  : t("auth.backToSignIn")}
            </button>
          </div>
        </form>
      )}

      <div className="auth-secondary">
        <button
          type="button"
          className="google-sign-in"
          disabled={busy || !online}
          onClick={() =>
            void run(() => adapter.signInGoogle(), t("auth.goingToGoogle"))
          }
        >
          {t("auth.signInWithGoogle")}
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
              ? t("auth.useEmailPassword")
              : t("auth.useEmailOtp")}
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
            {t("auth.usePhonePassword")}
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
            {t("auth.usePhoneOtp")}
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
