import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  DEFAULT_PHONE_COUNTRY,
  formatPhoneDisplay,
  normalizePhone,
} from "./phone.js";
import type { AuthAccount, AuthIdentityView, AuthAdapter } from "./adapter.js";
import { AuthUiError } from "./errors.js";
import { useT } from "../i18n/index.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Last-known identities per user, kept OUTSIDE React state so reopening
 * the account section renders the real binding status instantly instead
 * of flashing "未绑定" while the async list resolves. First open shows a
 * neutral "读取中…" — never a wrong status.
 */
const identityCache = new Map<string, AuthIdentityView[]>();

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
  const t = useT();
  const [identities, setIdentities] = useState<AuthIdentityView[] | null>(
    () => (account ? identityCache.get(account.userId) : undefined) ?? null,
  );
  const [form, setForm] = useState<RowForm | null>(null);
  // Same China-only decision as the sign-in panel: fixed +86, no picker.
  const countryCode = DEFAULT_PHONE_COUNTRY;
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!adapter || !account) return;
    try {
      const list = await adapter.listIdentities();
      identityCache.set(account.userId, list);
      setIdentities(list);
    } catch {
      // Keep the last-known status when a refresh fails; only fall back
      // to the neutral list if we never had one (surface on next action).
      setIdentities((previous) => previous ?? []);
    }
  }, [adapter, account]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!adapter || !account) return null;

  const loaded = identities !== null;
  const list = identities ?? [];
  const phoneIdentity = list.find((value) => value.provider === "phone");
  const emailIdentity = list.find((value) => value.provider === "email");
  const googleIdentity = list.find((value) => value.provider === "google");
  const passwordSet = adapter.passwordStatus(account.userId) === "SET";
  const unlinkAllowed = adapter.canUnlink(list);

  function fail(error: unknown) {
    setIsError(true);
    setMessage(
      error instanceof AuthUiError
        ? t(error.messageKey)
        : t("auth.actionFailed"),
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
      setMessage(t("auth.invalidPhone"));
      return;
    }
    void (async () => {
      const sent = await run(
        () => adapter!.linkPhone(normalized),
        t("auth.linkPhoneCodeSent"),
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
        t("auth.phoneLinked"),
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
      setMessage(t("auth.invalidEmail"));
      return;
    }
    void (async () => {
      const sent = await run(
        () => adapter!.linkEmail(value),
        t("auth.linkEmailCodeSent"),
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
        t("auth.emailLinked"),
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
        t("auth.passwordSet"),
      );
      if (done) closeForm();
    })();
  }

  function unlink(provider: string) {
    void (async () => {
      const done = await run(
        () => adapter!.unlink(provider),
        t("auth.unlinked"),
      );
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
        title={unlinkAllowed ? t("auth.unlink") : t("auth.keepLastIdentity")}
        onClick={() => unlink(provider)}
      >
        {t("auth.unlink")}
      </button>
    );

  return (
    <div className="identity-list">
      <p className="eyebrow">{t("auth.identitiesTitle")}</p>

      <section className="identity-row">
        <div>
          <strong>{t("auth.phoneLabel")}</strong>
          <small>
            {!loaded
              ? t("auth.loading")
              : phoneIdentity
                ? `${formatPhoneDisplay(phoneIdentity.label ?? account.phone ?? "")} · ${phoneIdentity.verified ? t("auth.verified") : t("auth.unverified")}`
                : t("auth.notLinked")}
          </small>
        </div>
        <div className="identity-actions">
          {loaded && !phoneIdentity && bindButton("phone", t("auth.linkPhone"))}
          {loaded &&
            phoneIdentity &&
            !phoneIdentity.verified &&
            bindButton("phone", t("auth.completeVerification"))}
          {unlinkButton("phone", Boolean(phoneIdentity))}
        </div>
        {form === "phone" && (
          <form onSubmit={submitBindPhone}>
            <label htmlFor="identity-phone">{t("auth.phoneLabel")}</label>
            <input
              id="identity-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel-national"
              placeholder={t("auth.phonePlaceholder")}
              required
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
            <div className="identity-form-actions">
              <button type="submit" disabled={busy || !online}>
                {busy ? t("auth.sending") : t("auth.sendCode")}
              </button>
              <button
                type="button"
                className="quiet-button"
                onClick={closeForm}
              >
                {t("common.cancel")}
              </button>
            </div>
          </form>
        )}
        {form === "phone-code" && (
          <form onSubmit={submitVerifyPhone}>
            <label htmlFor="identity-phone-code">{t("auth.smsCode")}</label>
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
                {busy ? t("auth.verifying") : t("auth.confirmLink")}
              </button>
              <button
                type="button"
                className="quiet-button"
                onClick={closeForm}
              >
                {t("common.cancel")}
              </button>
            </div>
          </form>
        )}
      </section>

      <section className="identity-row">
        <div>
          <strong>{t("auth.emailLabel")}</strong>
          <small>
            {!loaded
              ? t("auth.loading")
              : emailIdentity
                ? `${emailIdentity.label ?? account.email ?? ""} · ${emailIdentity.verified ? t("auth.verified") : t("auth.unverified")}`
                : t("auth.notLinked")}
          </small>
        </div>
        <div className="identity-actions">
          {loaded && !emailIdentity && bindButton("email", t("auth.linkEmail"))}
          {loaded &&
            emailIdentity &&
            !emailIdentity.verified &&
            bindButton("email", t("auth.completeVerification"))}
          {unlinkButton("email", Boolean(emailIdentity))}
        </div>
        {form === "email" && (
          <form onSubmit={submitBindEmail}>
            <label htmlFor="identity-email">{t("auth.emailLabel")}</label>
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
                {busy ? t("auth.sending") : t("auth.sendCode")}
              </button>
              <button
                type="button"
                className="quiet-button"
                onClick={closeForm}
              >
                {t("common.cancel")}
              </button>
            </div>
          </form>
        )}
        {form === "email-code" && (
          <form onSubmit={submitVerifyEmail}>
            <label htmlFor="identity-email-code">{t("auth.emailCode")}</label>
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
                {busy ? t("auth.verifying") : t("auth.confirmLink")}
              </button>
              <button
                type="button"
                className="quiet-button"
                onClick={closeForm}
              >
                {t("common.cancel")}
              </button>
            </div>
          </form>
        )}
      </section>

      <section className="identity-row">
        <div>
          <strong>Google</strong>
          <small>
            {!loaded
              ? t("auth.loading")
              : googleIdentity
                ? t("auth.linked")
                : t("auth.notLinked")}
          </small>
        </div>
        <div className="identity-actions">
          {loaded && !googleIdentity && (
            <button
              type="button"
              disabled={busy || !online}
              onClick={() =>
                void run(() => adapter!.linkGoogle(), t("auth.goingToGoogle"))
              }
            >
              {t("auth.linkGoogle")}
            </button>
          )}
          {unlinkButton("google", Boolean(googleIdentity))}
        </div>
      </section>

      <section className="identity-row">
        <div>
          <strong>{t("auth.passwordLabel")}</strong>
          <small>
            {passwordSet
              ? t("auth.passwordSetStatus")
              : t("auth.passwordNotSet")}
          </small>
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
            {passwordSet ? t("auth.changePassword") : t("auth.setPassword")}
          </button>
          <button
            type="button"
            className="quiet-button"
            disabled={busy || !online || !account.email}
            onClick={() =>
              void run(
                () => adapter!.requestPasswordReset(account.email ?? ""),
                t("auth.resetEmailSent"),
              )
            }
          >
            {t("auth.forgotPassword")}
          </button>
        </div>
        {form === "password" && (
          <form onSubmit={submitPassword}>
            <label htmlFor="identity-password">
              {passwordSet ? t("auth.newPassword") : t("auth.passwordLabel")}
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
                {busy ? t("common.saving") : t("common.save")}
              </button>
              <button
                type="button"
                className="quiet-button"
                onClick={closeForm}
              >
                {t("common.cancel")}
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
