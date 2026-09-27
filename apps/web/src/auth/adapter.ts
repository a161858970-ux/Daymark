/**
 * Account / Authentication adapter (Auth V1).
 *
 * Frozen product model:
 *
 *   ONE HUMAN -> ONE COURSE MANAGER ACCOUNT -> ONE auth.users.id
 *
 * Everything this module returns is keyed by `auth.users.id`. Email, phone
 * and Google are *identities / credentials* of that single account, never
 * owners and never accounts of their own. The adapter therefore exposes no
 * owner-shaped value other than `AuthAccount.userId`, which is the value the
 * existing sync worker already binds local data to.
 *
 * All calls delegate to Supabase Auth (no password, hash or credential is
 * ever stored by Course Manager) and every failure is translated by
 * `toAuthUiError` so provider internals never reach the UI.
 */

import { AuthUiError, toAuthUiError, type AuthOperation } from "./errors.js";

export interface AuthAccount {
  /** auth.users.id — the single business-data owner. */
  readonly userId: string;
  readonly email: string | null;
  readonly emailVerified: boolean;
  readonly phone: string | null;
}

export interface AuthIdentityView {
  readonly provider: string;
  readonly identityId: string;
  readonly label: string | null;
  readonly verified: boolean;
}

interface SessionUserLike {
  readonly id: string;
  readonly email?: string | null;
  readonly phone?: string | null;
  readonly email_confirmed_at?: string | null;
  readonly phone_confirmed_at?: string | null;
}

interface SessionLike {
  readonly user?: SessionUserLike | null;
}

interface IdentityLike {
  readonly provider?: string;
  readonly identity_id?: string;
  readonly id?: string;
  readonly email?: string | null;
  readonly phone?: string | null;
  readonly identity_data?: Record<string, unknown> | null;
}

interface AuthResult {
  readonly data: Record<string, unknown>;
  readonly error: unknown;
}

/**
 * The slice of supabase-js `GoTrueClient` this adapter uses. Declared here
 * (instead of importing Supabase types) so tests can supply a fake client
 * that behaves exactly like the documented provider flows.
 */
export interface AuthClientLike {
  getSession(): Promise<{ data: { session: SessionLike | null } }>;
  onAuthStateChange(
    callback: (event: string, session: SessionLike | null) => void,
  ): { data: { subscription: { unsubscribe(): void } } };
  signInWithOtp(params: Record<string, unknown>): Promise<AuthResult>;
  verifyOtp(params: Record<string, unknown>): Promise<AuthResult>;
  signInWithPassword(params: Record<string, unknown>): Promise<AuthResult>;
  signUp(params: Record<string, unknown>): Promise<AuthResult>;
  signInWithOAuth(params: Record<string, unknown>): Promise<AuthResult>;
  linkIdentity(params: Record<string, unknown>): Promise<AuthResult>;
  getUserIdentities(): Promise<{
    data: { identities: IdentityLike[] } | null;
    error: unknown;
  }>;
  unlinkIdentity(identity: IdentityLike): Promise<AuthResult>;
  updateUser(params: Record<string, unknown>): Promise<AuthResult>;
  resetPasswordForEmail(
    email: string,
    options?: Record<string, unknown>,
  ): Promise<AuthResult>;
  signOut(): Promise<{ error: unknown }>;
}

export type PasswordStatus = "SET" | "NOT_SET";

export interface AuthAdapter {
  getAccount(): Promise<AuthAccount | null>;
  listIdentities(): Promise<AuthIdentityView[]>;
  onAuthStateChange(callback: (account: AuthAccount | null) => void): {
    unsubscribe(): void;
  };

  sendEmailOtp(email: string): Promise<void>;
  verifyEmailOtp(email: string, token: string): Promise<AuthAccount>;
  sendPhoneOtp(phone: string): Promise<void>;
  verifyPhoneOtp(phone: string, token: string): Promise<AuthAccount>;

  signInEmailPassword(email: string, password: string): Promise<AuthAccount>;
  signInPhonePassword(phone: string, password: string): Promise<AuthAccount>;
  signUpEmailPassword(email: string, password: string): Promise<AuthAccount>;
  signUpPhonePassword(phone: string, password: string): Promise<AuthAccount>;

  /** Starts the Google OAuth redirect flow (sign in). */
  signInGoogle(): Promise<void>;
  /** Starts the Google OAuth redirect flow for the signed-in account. */
  linkGoogle(): Promise<void>;
  linkEmail(email: string): Promise<void>;
  linkPhone(phone: string): Promise<void>;
  verifyLinkEmail(email: string, token: string): Promise<void>;
  verifyLinkPhone(phone: string, token: string): Promise<void>;

  setPassword(password: string): Promise<void>;
  requestPasswordReset(email: string): Promise<void>;
  /** Recovery OTP from the reset email -> session (then setPassword). */
  completePasswordRecovery(email: string, token: string): Promise<AuthAccount>;
  passwordStatus(userId: string): PasswordStatus;

  canUnlink(identities: readonly AuthIdentityView[]): boolean;
  unlink(provider: string): Promise<void>;
  signOut(): Promise<void>;
}

function accountOf(
  session: SessionLike | null | undefined,
): AuthAccount | null {
  const user = session?.user;
  if (!user || typeof user.id !== "string") return null;
  return {
    userId: user.id,
    email: user.email ?? null,
    emailVerified: Boolean(user.email_confirmed_at),
    phone: user.phone ?? null,
  };
}

/**
 * Redirect targets are a browser concern; tests and SSR rendering run
 * without a `window`, so the origin degrades to an empty string there.
 */
function appOrigin(): string {
  return typeof window === "undefined" ? "" : window.location.origin;
}

function identityVerified(identity: IdentityLike): boolean {
  const data = identity.identity_data ?? {};
  return data.email_verified === true || data.phone_verified === true;
}

function identityLabel(identity: IdentityLike): string | null {
  const data = identity.identity_data ?? {};
  const candidate =
    identity.email ??
    identity.phone ??
    (typeof data.email === "string" ? data.email : null) ??
    (typeof data.phone === "string" ? data.phone : null);
  return candidate;
}

/** Supabase does not expose password state to the client; see docs/AUTH_REAL_VALIDATION.md. */
const PASSWORD_HINT_PREFIX = "cm.auth.password-set.";

export function createAuthAdapter(client: AuthClientLike): AuthAdapter {
  /**
   * In-memory fallback for environments without localStorage (tests, SSR).
   * Scoped to one adapter instance so two browser contexts never share state.
   */
  const memoryHints = new Map<string, PasswordStatus>();

  function readHint(userId: string): PasswordStatus {
    try {
      const stored = window.localStorage.getItem(PASSWORD_HINT_PREFIX + userId);
      if (stored !== null) return stored === "1" ? "SET" : "NOT_SET";
    } catch {
      /* storage unavailable: fall through to the session-local hint */
    }
    return memoryHints.get(userId) ?? "NOT_SET";
  }

  function writeHint(userId: string, value: PasswordStatus): void {
    memoryHints.set(userId, value);
    try {
      if (value === "SET")
        window.localStorage.setItem(PASSWORD_HINT_PREFIX + userId, "1");
      else window.localStorage.removeItem(PASSWORD_HINT_PREFIX + userId);
    } catch {
      /* private mode / storage disabled: status stays a best-effort hint */
    }
  }

  async function sessionAccount(): Promise<AuthAccount | null> {
    const { data } = await client.getSession();
    return accountOf(data.session);
  }

  async function requiredAccount(
    operation: AuthOperation,
  ): Promise<AuthAccount> {
    const account = await sessionAccount();
    if (!account)
      throw new AuthUiError(
        "NOT_AUTHENTICATED",
        operation,
        "请先登录账户后再操作。",
      );
    return account;
  }

  async function sendOtp(
    params: Record<string, unknown>,
    operation: AuthOperation,
  ): Promise<void> {
    try {
      const { error } = await client.signInWithOtp(params);
      if (error) throw error;
    } catch (error) {
      throw toAuthUiError(error, operation);
    }
  }

  async function verifyOtp(
    params: Record<string, unknown>,
    operation: AuthOperation,
  ): Promise<AuthAccount> {
    try {
      const { error } = await client.verifyOtp(params);
      if (error) throw error;
    } catch (error) {
      throw toAuthUiError(error, operation);
    }
    const { data } = await client.getSession();
    const account = accountOf(data.session);
    if (!account)
      throw new AuthUiError(
        "SESSION",
        operation,
        "登录状态已过期，请重新登录。",
      );
    return account;
  }

  async function passwordSignIn(
    params: Record<string, unknown>,
    operation: AuthOperation,
  ): Promise<AuthAccount> {
    try {
      const { error } = await client.signInWithPassword(params);
      if (error) throw error;
    } catch (error) {
      throw toAuthUiError(error, operation);
    }
    const account = await sessionAccount();
    if (!account)
      throw new AuthUiError(
        "SESSION",
        operation,
        "登录状态已过期，请重新登录。",
      );
    writeHint(account.userId, "SET");
    return account;
  }

  async function passwordSignUp(
    params: Record<string, unknown>,
    operation: AuthOperation,
  ): Promise<AuthAccount> {
    try {
      const { error } = await client.signUp(params);
      if (error) throw error;
    } catch (error) {
      throw toAuthUiError(error, operation);
    }
    const account = await sessionAccount();
    if (account) {
      writeHint(account.userId, "SET");
      return account;
    }
    // Email confirmation pending: Supabase returns no session yet, so there
    // is nothing to sign in with until the user verifies the address.
    throw new AuthUiError(
      "CONFIRMATION_REQUIRED",
      operation,
      "注册成功；请完成验证后再登录。",
    );
  }

  async function mutate(
    run: () => Promise<AuthResult>,
    operation: AuthOperation,
  ): Promise<void> {
    try {
      const { error } = await run();
      if (error) throw error;
    } catch (error) {
      throw toAuthUiError(error, operation);
    }
  }

  return {
    async getAccount() {
      return sessionAccount();
    },

    async listIdentities() {
      try {
        const { data, error } = await client.getUserIdentities();
        if (error) throw error;
        return (data?.identities ?? []).map((identity) => ({
          provider: identity.provider ?? "unknown",
          identityId: identity.identity_id ?? identity.id ?? "",
          label: identityLabel(identity),
          verified: identityVerified(identity),
        }));
      } catch (error) {
        throw toAuthUiError(error, "SESSION");
      }
    },

    onAuthStateChange(callback) {
      const listener = client.onAuthStateChange((_event, session) => {
        callback(accountOf(session));
      });
      return { unsubscribe: () => listener.data.subscription.unsubscribe() };
    },

    sendEmailOtp(email) {
      return sendOtp(
        { email, options: { emailRedirectTo: appOrigin() } },
        "SEND_EMAIL_OTP",
      );
    },

    verifyEmailOtp(email, token) {
      return verifyOtp({ email, token, type: "email" }, "VERIFY_OTP");
    },

    sendPhoneOtp(phone) {
      return sendOtp({ phone }, "SEND_PHONE_OTP");
    },

    verifyPhoneOtp(phone, token) {
      return verifyOtp({ phone, token, type: "sms" }, "VERIFY_OTP");
    },

    signInEmailPassword(email, password) {
      return passwordSignIn({ email, password }, "SIGN_IN");
    },

    signInPhonePassword(phone, password) {
      return passwordSignIn({ phone, password }, "SIGN_IN");
    },

    signUpEmailPassword(email, password) {
      return passwordSignUp(
        { email, password, options: { emailRedirectTo: appOrigin() } },
        "SIGN_UP",
      );
    },

    signUpPhonePassword(phone, password) {
      return passwordSignUp({ phone, password }, "SIGN_UP");
    },

    async signInGoogle() {
      await mutate(
        () =>
          client.signInWithOAuth({
            provider: "google",
            options: { emailRedirectTo: appOrigin() },
          }),
        "SIGN_IN",
      );
    },

    async linkGoogle() {
      await requiredAccount("LINK_IDENTITY");
      await mutate(
        () =>
          client.linkIdentity({
            provider: "google",
            options: { emailRedirectTo: appOrigin() },
          }),
        "LINK_IDENTITY",
      );
    },

    async linkEmail(email) {
      await requiredAccount("LINK_IDENTITY");
      await mutate(
        () =>
          client.updateUser({
            email,
            options: { emailRedirectTo: appOrigin() },
          }),
        "LINK_IDENTITY",
      );
    },

    async linkPhone(phone) {
      await requiredAccount("LINK_IDENTITY");
      await mutate(() => client.updateUser({ phone }), "LINK_IDENTITY");
    },

    verifyLinkEmail(email, token) {
      return verifyOtp(
        { email, token, type: "email_change" },
        "VERIFY_OTP",
      ).then(() => undefined);
    },

    verifyLinkPhone(phone, token) {
      return verifyOtp(
        { phone, token, type: "phone_change" },
        "VERIFY_OTP",
      ).then(() => undefined);
    },

    async setPassword(password) {
      const account = await requiredAccount("PASSWORD");
      await mutate(() => client.updateUser({ password }), "PASSWORD");
      writeHint(account.userId, "SET");
    },

    async requestPasswordReset(email) {
      await mutate(
        () =>
          client.resetPasswordForEmail(email, {
            redirectTo: appOrigin(),
          }),
        "PASSWORD",
      );
    },

    completePasswordRecovery(email, token) {
      return verifyOtp({ email, token, type: "recovery" }, "PASSWORD");
    },

    passwordStatus(userId) {
      return readHint(userId);
    },

    canUnlink(identities) {
      // Supabase Auth requires at least two linked identities to unlink one;
      // Course Manager additionally must never remove the last login path.
      return identities.length >= 2;
    },

    async unlink(provider) {
      await requiredAccount("UNLINK_IDENTITY");
      try {
        const { data, error } = await client.getUserIdentities();
        if (error) throw error;
        const identities = data?.identities ?? [];
        if (identities.length < 2)
          throw new AuthUiError(
            "VALIDATION_FAILED",
            "UNLINK_IDENTITY",
            "至少保留一种登录方式，无法解除最后的绑定。",
          );
        const target = identities.find(
          (identity) => identity.provider === provider,
        );
        if (!target)
          throw new AuthUiError(
            "NOT_FOUND",
            "UNLINK_IDENTITY",
            "该登录方式尚未绑定。",
          );
        const { error: unlinkError } = await client.unlinkIdentity(target);
        if (unlinkError) throw unlinkError;
      } catch (error) {
        throw toAuthUiError(error, "UNLINK_IDENTITY");
      }
    },

    async signOut() {
      try {
        const { error } = await client.signOut();
        if (error) throw error;
      } catch (error) {
        throw toAuthUiError(error, "SIGN_OUT");
      }
    },
  };
}

/**
 * OAuth / recovery returns land on the redirect URL with an error query when
 * Supabase cannot complete the flow (identity_already_exists for a link that
 * already belongs to another user, provider_denied, ...). Parse it into the
 * same product copy as direct errors; PKCE session exchange is handled by
 * supabase-js itself.
 */
export function readAuthRedirectError(search: string): string | null {
  return redirectErrorMessage(search, "");
}

/**
 * Some providers return the failure in the query string, others in the hash
 * fragment. Read both, preferring the explicit `error_code`.
 */
export function redirectErrorMessage(
  search: string,
  hash: string,
): string | null {
  const params = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search,
  );
  const fragment = hash.startsWith("#") ? hash.slice(1) : hash;
  if (fragment) {
    const fromHash = new URLSearchParams(fragment);
    for (const key of ["error_code", "error", "error_description"]) {
      const value = fromHash.get(key);
      if (value) params.set(key, value);
    }
  }
  const code = (
    params.get("error_code") ??
    params.get("error") ??
    ""
  ).toLowerCase();
  if (!code) return null;
  if (
    code.includes("identity_already_exists") ||
    code.includes("provider_already_exists")
  )
    return "该登录方式已经关联其他账号。";
  if (code.includes("access_denied")) return "登录未完成，请重试。";
  return "登录未完成，请稍后再试。";
}

/**
 * Snapshot at module load: supabase-js may rewrite the URL while it finishes
 * the OAuth/PKCE exchange during startup, so the app must capture any failure
 * before the client is constructed (this module is imported first).
 */
const STARTUP_REDIRECT_ERROR =
  typeof window === "undefined"
    ? null
    : redirectErrorMessage(window.location.search, window.location.hash);

export function getStartupRedirectError(): string | null {
  return STARTUP_REDIRECT_ERROR;
}

/** Remove auth error parameters after they have been surfaced once. */
export function clearAuthRedirect(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  const errorKeys = ["error", "error_code", "error_description"];
  for (const key of errorKeys) url.searchParams.delete(key);
  const fragment = url.hash.startsWith("#") ? url.hash.slice(1) : "";
  if (fragment) {
    const fromHash = new URLSearchParams(fragment);
    let touched = false;
    for (const key of errorKeys)
      if (fromHash.has(key)) {
        fromHash.delete(key);
        touched = true;
      }
    if (touched) {
      const value = fromHash.toString();
      url.hash = value ? `#${value}` : "";
    }
  }
  window.history.replaceState({}, "", url.toString());
}
