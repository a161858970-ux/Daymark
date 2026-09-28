import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { createAuthAdapter, type AuthClientLike } from "./adapter.js";
import { AccountIdentities } from "./AccountIdentities.js";
import { SignInPanel } from "./SignInPanel.js";

/** Rendering only: no provider call is made, so a stub client is enough. */
const adapter = createAuthAdapter({} as AuthClientLike);

it("keeps phone OTP primary, Google secondary and e-mail tertiary", () => {
  const markup = renderToStaticMarkup(<SignInPanel online adapter={adapter} />);
  const phoneIndex = markup.indexOf('id="auth-phone"');
  const googleIndex = markup.indexOf("使用 Google 登录");
  const emailSwitchIndex = markup.indexOf("使用邮箱登录");
  expect(phoneIndex).toBeGreaterThan(-1);
  expect(googleIndex).toBeGreaterThan(phoneIndex);
  expect(emailSwitchIndex).toBeGreaterThan(googleIndex);
  expect(markup).toContain("获取验证码");
  // No five-button wall on the first screen.
  expect(markup).not.toContain("发送邮箱验证码");
});

it("explains the disabled state when account sync is not configured", () => {
  const markup = renderToStaticMarkup(<SignInPanel online adapter={null} />);
  expect(markup).toContain("账户登录尚未启用");
  expect(markup).not.toContain("获取验证码");
});

it("lists every login method with its binding status for a signed-in account", () => {
  const markup = renderToStaticMarkup(
    <AccountIdentities
      online
      adapter={adapter}
      account={{
        userId: "11111111-1111-4111-8111-111111111111",
        email: "student@cufe.edu.cn",
        emailVerified: true,
        phone: null,
      }}
    />,
  );
  expect(markup).toContain("登录方式");
  expect(markup).toContain("手机号");
  expect(markup).toContain("邮箱");
  expect(markup).toContain("Google");
  expect(markup).toContain("密码");
  expect(markup).toContain("绑定手机号");
  expect(markup).toContain("绑定 Google");
});

it("shows one China phone field with no country picker or +86 prefix", () => {
  const markup = renderToStaticMarkup(<SignInPanel online adapter={adapter} />);
  expect(markup).toContain('id="auth-phone"');
  expect(markup).toContain('placeholder="11 位手机号"');
  expect(markup).not.toContain("国家 / 地区");
  expect(markup).not.toContain("+86");
  expect(markup).not.toContain("中国香港");
});

it("renders nothing for the identity section while signed out", () => {
  const markup = renderToStaticMarkup(
    <AccountIdentities online adapter={adapter} account={null} />,
  );
  expect(markup).toBe("");
});
