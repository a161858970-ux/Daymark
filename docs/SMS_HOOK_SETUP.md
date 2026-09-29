# 手机验证码短信（阿里云 PNVS × Supabase Send SMS Hook）

- 状态：**已部署并真机验收 `VERIFIED REAL`（2026-09-28 15:32 首条真实短信送达、登录成功）**；**签名校验已于 2026-09-29 恢复开启并端到端验收**（验签 + 真实短信同一次请求内通过）
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

| 现象                                                                                      | 真因                                                                                                                                                                                                                                                                                                | 处理                                                                                       |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `pnpm dlx supabase ...` 报 `unexpected character "P" in variable name near "Project URL"` | `.env` 里有两行**没有 `=`** 的残留标签                                                                                                                                                                                                                                                              | 注释掉即可（CLI 会自行解析 `.env`）                                                        |
| 请求函数返回 `401 {"error":"bad signature"}`                                              | **函数自身的密钥字节 bug**：`atob()` 返回二进制字符串，旧代码用 `TextEncoder`（UTF-8）再编码当 HMAC 密钥，密钥里任何 ≥0x80 的字节都被扩成两字节 ⇒ **正确密钥也永远验不过**（当年"只认 `whsec_` 前缀""存的是哈希拿不到明文"都是误判，配置 API 回读的 64 位十六进制只是展示用的哈希，与能否验签无关） | 改用 `keyBytes()` 把字节原样交给 `importKey`（2026-09-29）；随后轮换新密钥并开回校验，见下 |
| 阿里云返回 `isv.OUT_OF_SERVICE`                                                           | **账户余额不足、账号被暂停**（与 RegionId 无关，三种区域返回一致）                                                                                                                                                                                                                                  | 充值中心充值后自动恢复                                                                     |
| 阿里云返回 `SignatureDoesNotMatch`                                                        | RPC V1 签名串拼接/编码错误                                                                                                                                                                                                                                                                          | 核对 `POST&%2F&` + RFC3986 编码（空格→%20、`*`→%2A、`~` 不编码）                           |

> 预检技巧：用**非法号码**（如 `12345678901`）打一次真实请求 —— 阿里云会先校验签名再校验号码，因此
> `SignatureDoesNotMatch` = 签名错；`MOBILE_NUMBER_ILLEGAL` 等号码类错误 = **链路已通**；整个过程**不会真的发出短信**。

### 真机联调结论（2026-09-28 15:32 首条真实短信成功）

- **链路打通**：`/auth/v1/otp` → Send SMS Hook → Edge Function → 阿里云 PNVS → 手机收到 `【恒创联众】…`；
  函数日志 `send-sms: delivered`，`auth.users` 新增 `providers=phone` 用户。
- **GoTrue 的 Hook 载荷**：`{"metadata":{…},"user":{…},"sms":{…}}`，其中 **`user.phone` 不带 `+`**（`86138…`）；
  手机号解析需兼容 `+86… / 86… / 11位` 三种写法，否则返回 `Invalid payload sent to hook`。
- **签名校验：2026-09-29 已恢复开启并端到端验收**。当年"验不过"的真因是函数自身的密钥字节 bug（见上排障表），**与"拿不到明文密钥"无关**；`hook_send_sms_secrets` 回读的 64 位十六进制只是展示哈希，不代表密钥取不到。
  本次已轮换为一把我方生成的新密钥，三处保持同值：Dashboard 配置 `hook_send_sms_secrets`、Edge secret `SEND_SMS_WEBHOOK_SECRET`、仓库根 `.env`（不入库）。补偿措施（仅接受 `1[3-9]` 号段大陆手机号 + 同号 60 秒冷却，429 + `Retry-After`）继续保留。
  **验收证据（2026-09-29）**：错误密钥 → `401 bad signature`；正确密钥 → `400 unusable payload`（已过验签、进入 payload 校验）；真实 `POST /auth/v1/otp` → 日志 `send-sms: verified key=1 msg=1` + `send-sms: delivered`，HTTP 200（2.6 s）。
  **残余风险（观察级）**：阿里云下发偶发超过 GoTrue 的 5 秒 Hook 上限 → 客户端 `422 hook_timeout`。基线（验签关闭）同样复现，**与验签无关**，重试即可通过；若反复出现需查阿里云侧（余额/频控）。
  **要再次轮换密钥**：生成 `v1,whsec_<base64(32 字节)>` → `PATCH /v1/projects/{ref}/config/auth` 写 `hook_send_sms_secrets` → `supabase secrets set SEND_SMS_WEBHOOK_SECRET=<同值>` → 同步写入 `.env` → 按下方验收清单跑一条。

## 已知风险

- GoTrue 在无内置 SMS provider 时是否放行 hook 发送 —— 部署后第一步验证；若被拦，需在 Dashboard 的 Phone provider 里补一个占位配置（届时按报错处理）。
- 赠送模板的变量名/字数限制以控制台实际模板为准。
- PNVS 单号码频控与计费以控制台价格页为准（短信按运营商回执计费，核验免费）。
