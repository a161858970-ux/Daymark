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

## 排障实录（2026-09-28 联调时真实踩过）

| 现象                                                                                      | 真因                                                                                                                                     | 处理                                                                                                                                      |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dlx supabase ...` 报 `unexpected character "P" in variable name near "Project URL"` | `.env` 里有两行**没有 `=`** 的残留标签                                                                                                   | 注释掉即可（CLI 会自行解析 `.env`）                                                                                                       |
| 请求函数返回 `401 {"error":"bad signature"}`                                              | ① 校验代码只认 `whsec_` 开头、不认 `v1,whsec_`；② **Supabase 没采用我方密钥，而是在 `hook_send_sms_secrets` 里自建了 64 位十六进制密钥** | 用 Management API `GET /v1/projects/{ref}/config/auth` 读回**服务端存的那个值**，写入 `SEND_SMS_WEBHOOK_SECRET` 并 `supabase secrets set` |
| 阿里云返回 `isv.OUT_OF_SERVICE`                                                           | **账户余额不足、账号被暂停**（与 RegionId 无关，三种区域返回一致）                                                                       | 充值中心充值后自动恢复                                                                                                                    |
| 阿里云返回 `SignatureDoesNotMatch`                                                        | RPC V1 签名串拼接/编码错误                                                                                                               | 核对 `POST&%2F&` + RFC3986 编码（空格→%20、`*`→%2A、`~` 不编码）                                                                          |

> 预检技巧：用**非法号码**（如 `12345678901`）打一次真实请求 —— 阿里云会先校验签名再校验号码，因此
> `SignatureDoesNotMatch` = 签名错；`MOBILE_NUMBER_ILLEGAL` 等号码类错误 = **链路已通**；整个过程**不会真的发出短信**。

## 已知风险

- GoTrue 在无内置 SMS provider 时是否放行 hook 发送 —— 部署后第一步验证；若被拦，需在 Dashboard 的 Phone provider 里补一个占位配置（届时按报错处理）。
- 赠送模板的变量名/字数限制以控制台实际模板为准。
- PNVS 单号码频控与计费以控制台价格页为准（短信按运营商回执计费，核验免费）。
