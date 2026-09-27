/**
 * Auth error translation: Supabase Auth error codes -> product copy.
 *
 * Raw provider messages never reach the UI (no internal implementation
 * leakage). Unknown codes fall back to a per-operation message so a new
 * provider error cannot break the surface.
 */

export const SMS_PROVIDER_NOT_CONFIGURED = "SMS_PROVIDER_NOT_CONFIGURED";

export type AuthOperation =
  | "SEND_EMAIL_OTP"
  | "SEND_PHONE_OTP"
  | "VERIFY_OTP"
  | "SIGN_IN"
  | "SIGN_UP"
  | "LINK_IDENTITY"
  | "UNLINK_IDENTITY"
  | "PASSWORD"
  | "SIGN_OUT"
  | "SESSION";

export class AuthUiError extends Error {
  readonly code: string;

  readonly operation: AuthOperation;

  constructor(code: string, operation: AuthOperation, message: string) {
    super(message);
    this.name = "AuthUiError";
    this.code = code;
    this.operation = operation;
  }
}

interface AuthErrorLike {
  readonly code?: string;
  readonly message?: string;
  readonly status?: number;
}

/** Fallbacks when the provider returns an error code we do not know yet. */
const FALLBACKS: Record<AuthOperation, string> = {
  SEND_EMAIL_OTP: "暂时无法发送邮箱验证码，请稍后再试。",
  SEND_PHONE_OTP: "暂时无法发送短信验证码，请稍后再试。",
  VERIFY_OTP: "验证码不正确或已过期，请重新获取。",
  SIGN_IN: "登录未成功，请检查账号信息后重试。",
  SIGN_UP: "注册未成功，请稍后再试。",
  LINK_IDENTITY: "该登录方式暂时无法绑定。",
  UNLINK_IDENTITY: "暂时无法解除绑定。",
  PASSWORD: "密码操作未成功，请稍后再试。",
  SIGN_OUT: "暂时无法退出账户，请稍后再试。",
  SESSION: "登录状态已过期，请重新登录。",
};

const BY_CODE: Record<string, (operation: AuthOperation) => string> = {
  OTP_EXPIRED: () => "验证码已过期，请重新获取。",
  OTP_ALREADY_USED: () => "验证码已失效，请重新获取。",
  INVALID_CREDENTIALS: (operation) =>
    operation === "VERIFY_OTP"
      ? "验证码不正确或已过期，请重新获取。"
      : "账号或密码不正确。",
  EMAIL_NOT_CONFIRMED: () => "请先完成邮箱验证后再登录。",
  USER_ALREADY_EXISTS: () => "该邮箱已注册，请直接登录。",
  USER_NOT_FOUND: () => "账号不存在，请先创建账户。",
  WEAK_PASSWORD: () => "密码强度不足，请更换更复杂的密码。",
  IDENTITY_ALREADY_EXISTS: () => "该登录方式已经关联其他账号。",
  PROVIDER_ALREADY_EXISTS: () => "该登录方式已经关联其他账号。",
  NOT_AUTHENTICATED: () => "请先登录账户后再操作。",
  SESSION_NOT_FOUND: () => "登录状态已过期，请重新登录。",
  REFRESH_TOKEN_NOT_FOUND: () => "登录状态已过期，请重新登录。",
  SESSION_EXPIRED: () => "登录状态已过期，请重新登录。",
  VALIDATION_FAILED: (operation) =>
    operation === "UNLINK_IDENTITY"
      ? "至少保留一种登录方式，无法解除最后的绑定。"
      : "输入有误，请检查后重试。",
  RATE_LIMIT: () => "操作过于频繁，请稍后再试。",
  OVERDUE_SMS_SEND_RATE_LIMIT: () => "短信发送过于频繁，请稍后再试。",
  SMS_SEND_RATE_LIMIT: () => "短信发送过于频繁，请稍后再试。",
  EMAIL_RATE_LIMIT_EXCEEDED: () => "邮件发送过于频繁，请稍后再试。",
  OVERDUE_EMAIL_SEND_RATE_LIMIT: () => "邮件发送过于频繁，请稍后再试。",
  SIGNUP_DISABLED: () => "当前项目暂未开放注册。",
  PROVIDER_DISABLED: () => "该登录方式暂时不可用。",
  MANUAL_LINKING_DISABLED: () =>
    "身份绑定尚未开启：请在 Supabase 项目设置中启用 Enable Manual Linking。",
  SMS_PROVIDER_NOT_CONFIGURED: () =>
    "短信通道尚未配置（SMS_PROVIDER_NOT_CONFIGURED）；请先配置 SMS Provider 或改用邮箱登录。",
};

function codeOf(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const candidate = error as AuthErrorLike;
  if (typeof candidate.code === "string" && candidate.code.trim())
    return candidate.code.trim().toUpperCase();
  return null;
}

function messageOf(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as AuthErrorLike).message;
    if (typeof message === "string") return message;
  }
  if (error instanceof Error) return error.message;
  return "";
}

function statusOf(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const status = (error as AuthErrorLike).status;
  return typeof status === "number" ? status : null;
}

/**
 * SMS provider failures surface as provider-side 500s with an SMS message.
 * They are an external configuration state, not an application bug.
 */
function isSmsProviderMissing(error: unknown): boolean {
  const message = messageOf(error);
  return (
    /sms/i.test(message) &&
    (statusOf(error) === 500 || /not configured|provider error/i.test(message))
  );
}

/** Convert any Supabase Auth error into a user-readable product error. */
export function toAuthUiError(
  error: unknown,
  operation: AuthOperation,
): AuthUiError {
  if (error instanceof AuthUiError) return error;
  const rawCode = codeOf(error);
  const smsMissing = BY_CODE[SMS_PROVIDER_NOT_CONFIGURED];
  if (isSmsProviderMissing(error) && smsMissing)
    return new AuthUiError(
      SMS_PROVIDER_NOT_CONFIGURED,
      operation,
      smsMissing(operation),
    );
  const mapped = rawCode ? BY_CODE[rawCode] : undefined;
  if (rawCode && mapped)
    return new AuthUiError(rawCode, operation, mapped(operation));
  // Some provider failures only carry a status (e.g. plain HTTP 429).
  const status = statusOf(error);
  const rateLimited = BY_CODE.RATE_LIMIT;
  if (status === 429 && rateLimited)
    return new AuthUiError("RATE_LIMIT", operation, rateLimited(operation));
  return new AuthUiError(
    rawCode ?? "AUTH_ERROR",
    operation,
    FALLBACKS[operation],
  );
}

export function isAuthConfiguredError(error: unknown): boolean {
  return error instanceof Error && error.message === "Auth is not configured";
}
