# 手机验证码短信（阿里云 PNVS × Supabase Send SMS Hook）

- 状态：实现完成，待凭据部署与真机验收（2026-09-28）
- 关联：`docs/FINAL_RELEASE_VALIDATION.md` B2、`supabase/functions/send-sms/index.ts`

## 为什么走这条路

| 方案                                            | 结论                                                                                                     |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 腾讯云短信 / 阿里云短信（签名+模板）            | **个人主体无法认证**，仅企业 → 淘汰                                                                      |
| 阿里云**号码认证服务 PNVS** `SendSmsVerifyCode` | 用控制台**赠送签名+赠送模板**（免审核、免企业资质），**仅支持大陆号码**，核验免费、只收短信费 → **采用** |

关键能力（官方文档确认）：`TemplateParam` 支持**直接传固定验证码**

```json
{"code":"##code##","min":"5"}   // 阿里云自己生成
{"code":"123456","min":"5"}     // 调用方提供，原样下发
```

因此 **Supabase Auth 自己生成并核验 OTP**，本函数只负责把同一个码发出去，**不需要**调用 `CheckSmsVerifyCode`。

## 数据流

```text
用户点「获取验证码」
  → Supabase Auth 生成 OTP
  → 触发 Send SMS Hook（HTTP，Standard Webhooks 签名）
  → Edge Function send-sms：校验签名 → 取 user.phone / sms.otp
  → RPC V1 签名（HMAC-SHA1）调 dypnsapi.aliyuncs.com Action=SendSmsVerifyCode
  → 用户收到短信，Supabase verifyOtp 核验
```

## 前置凭据（写入仓库根 `.env`，不要贴进聊天）

```env
# 阿里云 RAM 子账号 AccessKey（权限至少 dypns:SendSmsVerifyCode）
ALIYUN_ACCESS_KEY_ID=
ALIYUN_ACCESS_KEY_SECRET=
# PNVS 控制台「赠送签名配置」「赠送模板配置」
PNVS_SIGN_NAME=
PNVS_TEMPLATE_CODE=
PNVS_TEMPLATE_PARAM_KEY=code
PNVS_TEMPLATE_MIN_KEY=min
PNVS_TEMPLATE_MIN=5
# Supabase CLI 部署用（Dashboard → Account → Access Tokens）
SUPABASE_ACCESS_TOKEN=
```

> 模板变量名以**赠送模板原文**为准：模板写 `${code}` 就用 `code`；若模板没有分钟数变量，把 `PNVS_TEMPLATE_MIN_KEY` 置空。

## 部署

```bash
# 1) 设置密钥（只进 Supabase，不进 git）
SUPABASE_ACCESS_TOKEN=$(grep '^SUPABASE_ACCESS_TOKEN=' .env | cut -d= -f2-)
pnpm dlx supabase functions deploy send-sms --project-ref xaqmzjhvewkrpnqaunwd
pnpm dlx supabase secrets set \
  ALIYUN_ACCESS_KEY_ID=... ALIYUN_ACCESS_KEY_SECRET=... \
  PNVS_SIGN_NAME=... PNVS_TEMPLATE_CODE=... \
  --project-ref xaqmzjhvewkrpnqaunwd
```

## 配置 Hook（Supabase Dashboard）

1. Dashboard → **Authentication → Hooks → Send SMS** → 启用 **HTTP Endpoint**
2. URL：`https://xaqmzjhvewkrpnqaunwd.supabase.co/functions/v1/send-sms`
3. 复制生成的 **secret**（`v1,whsec_…`）→ `supabase secrets set SEND_SMS_WEBHOOK_SECRET=v1,whsec_...`
4. Authentication → Settings：确认 **Phone auth 已启用**、OTP 有效期与 `PNVS_TEMPLATE_MIN` 一致

## 验收清单（对应 B2 手机号项）

1. 登录面板「获取验证码」→ 手机收到短信，**内容里的码 = 输入后能登录成功**
2. Supabase → Edge Functions → send-sms → Logs：出现 `delivered biz=…`，无 `signature rejected`
3. 故意输错码 → 被 Supabase 拒绝（说明核验仍在 Supabase 侧）
4. 服务端核对：`auth.users` 新增 phone 用户、`identities` 含 `provider=phone`

## 已知风险

- GoTrue 在无内置 SMS provider 时是否放行 hook 发送 —— 部署后第一步验证；若被拦，需在 Dashboard 的 Phone provider 里补一个占位配置（届时按报错处理）。
- 赠送模板的变量名/字数限制以控制台实际模板为准。
- PNVS 单号码频控与计费以控制台价格页为准（短信按运营商回执计费，核验免费）。
