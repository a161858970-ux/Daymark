# AUTH REAL VALIDATION — Account / Authentication v1

> 状态基线：`apps/web/src/auth/*` 实现完成，自动测试全部通过（fake provider）。
> 本文件是**真实 Supabase 环境**验收的执行清单与证据表。
> 结果列只允许：`SIMULATED` / `VERIFIED REAL` / `BLOCKED BY EXTERNAL CONFIGURATION`。

## 0. 冻结的账户模型

```
ONE HUMAN
  → ONE COURSE MANAGER ACCOUNT
  → ONE Supabase auth.users.id          ← 业务数据唯一 owner
  → 多个 authentication identities：手机号 / 邮箱 / Google + 凭证（OTP / 密码）
```

- `Course / Item / RawCapture / Reminder / Sync / Conflict` 的 `owner` 永远是 `auth.users.id`。
- **禁止**使用 email、phone、Google provider id 作为 owner。
- 登录方式变化（Phone → Email → Google）只要属于同一个 `auth.users.id`：
  业务数据不迁移、本地绑定（`local_owner_id` / `sync_bound_owner_id`）不重绑。
- 不同 `auth.users.id`：沿用既有安全策略，本地数据不会迁给另一个账户。

## 1. 架构与改动文件

| 层           | 文件                                      | 职责                                                                                    |
| ------------ | ----------------------------------------- | --------------------------------------------------------------------------------------- |
| 手机号规范化 | `apps/web/src/auth/phone.ts`              | E.164 归一化、国家/地区选择（默认 `+86`，不锁死中国大陆）                               |
| 错误映射     | `apps/web/src/auth/errors.ts`             | Supabase 错误码 → 产品文案；`SMS_PROVIDER_NOT_CONFIGURED` 外部状态                      |
| Auth adapter | `apps/web/src/auth/adapter.ts`            | 唯一出入点：OTP / 密码 / OAuth / link / unlink / 密码重置；owner 只暴露 `auth.users.id` |
| 登录界面     | `apps/web/src/auth/SignInPanel.tsx`       | PRIMARY 手机号验证码 → SECONDARY Google → TERTIARY 邮箱（验证码 / 密码）                |
| 身份管理     | `apps/web/src/auth/AccountIdentities.tsx` | 登录方式列表、绑定、验证、设置/修改密码、解除绑定                                       |
| 账户入口     | `apps/web/src/AccountControl.tsx`         | 登录态监听、OAuth/recovery 回跳错误一次性提示                                           |
| 接线         | `apps/web/src/authSync.ts`                | `authAdapter`（原 `sendSignInLink` 魔法链接入口已移除）                                 |
| 样式         | `apps/web/src/styles.css`                 | `.auth-panel` / `.identity-*` 系列                                                      |

**数据库变更：无。** owner 仍是 `auth.users.id`，无新表、无新列，不存密码/哈希/凭据。

**登录方式优先级**：第一屏只有手机号验证码一条主动线 + Google 次要入口；邮箱登录为第三级折叠入口，不平铺五个按钮。

**Email OTP**：走 `signInWithOtp()` + `verifyOtp({type:"email"})`，**不再以 magic link 作为普通登录方式**；recovery / verification 的邮件链接能力保留在 Supabase 侧。

**Phone OTP**：`signInWithOtp({phone})` + `verifyOtp({type:"sms"})`；SMS provider 通过 Supabase Auth 抽象接入，应用内不硬编码任何短信厂商、不发送真实短信。

**Identity linking**：`linkIdentity({provider:"google"})` / `updateUser({email|phone})` + 对应 verification OTP；绑定前必须验证候选 identity 的控制权；候选 identity 已属于其他用户 → 明确报错「该登录方式已经关联其他账号。」，不合并、不删除、不迁移、不产生第三个用户。

**Unlink 保护**：遵循 Supabase 原生约束（至少两个 identity 才能解除），UI 侧同样用 `canUnlink()` 拦截，保证至少保留一条登录路径。

## 2. Supabase Dashboard 配置清单

必须在 Dashboard 完成，缺一项对应流程就保持 `BLOCKED BY EXTERNAL CONFIGURATION`：

1. **Authentication → Providers → Email**
   - Enable Email provider：ON
   - Confirm email（`mailer_autoconfirm`）：按需；关闭时注册后需先验证
   - SMTP：配置真实邮件服务（当前项目 **未配置**，邮件类验收被阻塞）
2. **Authentication → Providers → Phone**
   - Enable Phone provider：ON
   - SMS Provider（Twilio / MessageBird / Vonage 等）或 Send SMS Hook：当前**未配置** → 运行时状态 `SMS_PROVIDER_NOT_CONFIGURED`（明确外部状态，不阻塞其余 Auth 实现）
   - OTP：默认 60s 重发间隔、1h 过期
3. **Authentication → Providers → Google**
   - Google OAuth Client ID / Secret
   - Authorized redirect URI：`https://<PROJECT-REF>.supabase.co/auth/v1/callback`
4. **Authentication → Settings**
   - **Enable Manual Linking：ON**（否则 `linkIdentity()` 返回 422）
   - Site URL：开发环境 `http://127.0.0.1:5173`（或 `http://localhost:5173`）
   - Redirect URLs：加入 `http://127.0.0.1:5173`、`http://localhost:5173`，生产环境另行追加
5. **Authentication → Email Templates**
   - 普通登录邮件改为 **OTP 模板**：正文包含 `{{ .Token }}`（6 位验证码）
   - 保留 recovery / verification 所需邮件流程，不要破坏 `{{ .ConfirmationURL }}` 的其它用途
6. **Rate limits / CAPTCHA**
   - 邮件、短信发送频率限制保持开启（登录 UI 已按 60s 倒计时限制重发）
   - 如开启 CAPTCHA，需要 `signInWithOtp({ options: { captchaToken } })` 适配
7. **密钥边界**
   - 浏览器只允许：`VITE_SUPABASE_URL`、`VITE_SUPABASE_PUBLISHABLE_KEY`
   - `service_role` / secret key **绝不允许**进入 `VITE_*` 或前端代码（当前 `.env` 中亦未放置）

## 3. 真实验收表（12 项）

| #   | Initial                           | Operation                                     | Expected                                                                    | Actual                                                                              | Result                                                    | Evidence                                                           |
| --- | --------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------ |
| 1   | 未登录                            | 邮箱验证码登录（send → code → verify）        | 得到 session，`user.id` 为 owner                                            | 待执行                                                                              | BLOCKED BY EXTERNAL CONFIGURATION（未配置 SMTP）          | `adapter.test.ts` 2.（SIMULATED）                                  |
| 2   | 未登录                            | 手机号验证码登录                              | 得到 session，手机号 identity 已验证                                        | 待执行                                                                              | BLOCKED BY EXTERNAL CONFIGURATION（未配置 SMS Provider）  | `adapter.test.ts` 1.、30.（SIMULATED）                             |
| 3   | 未登录                            | 邮箱 + 密码登录                               | 同一 `auth.users.id`                                                        | 注册即返回 session，owner=`645027f0-7b61-480d-9b3d-9c1ad264ee45`，capture→push 落库 | **VERIFIED REAL** 2026-09-27                              | Dashboard 注册 + 浏览器登录截图 + `change_log` 6 行 + `items` 1 行 |
| 4   | 未登录                            | 手机号 + 密码登录                             | 同一 `auth.users.id`                                                        | 待执行                                                                              | SIMULATED                                                 | `adapter.test.ts` 4.、19.                                          |
| 5   | 未登录                            | Google OAuth 登录                             | 回跳后建立/复用同一 user                                                    | 待执行                                                                              | BLOCKED BY EXTERNAL CONFIGURATION（未配置 Google Client） | `adapter.test.ts` 5.（SIMULATED）                                  |
| 6   | 已登录（邮箱）                    | Account → 绑定 Google（`linkIdentity`）       | 新增 google identity，user 不变                                             | 待执行                                                                              | SIMULATED（需 Dashboard 开启 Manual Linking）             | `adapter.test.ts` 7.                                               |
| 7   | 已登录                            | 绑定邮箱 + 验证                               | 出现 verified email identity                                                | 待执行                                                                              | SIMULATED                                                 | `adapter.test.ts` 8.                                               |
| 8   | 已登录                            | 绑定手机号 + 验证                             | 出现 verified phone identity                                                | 待执行                                                                              | BLOCKED BY EXTERNAL CONFIGURATION（SMS）                  | `adapter.test.ts` 9.（SIMULATED）                                  |
| 9   | 邮箱登录 → 切换手机号/Google 登录 | 依次用三种方式登录                            | `owner_id` 全程不变，本地数据不迁移                                         | 待执行                                                                              | SIMULATED                                                 | `adapter.test.ts` 16-19.；`owner-continuity.test.ts`               |
| 10  | 已登录                            | 退出账户 → 重新登录                           | 会话恢复，owner 相同                                                        | 待执行                                                                              | SIMULATED                                                 | `adapter.test.ts` 15.                                              |
| 11  | 任意登录方式                      | 检查 `local_owner_id` / `sync_bound_owner_id` | 与 `auth.users.id` 一致且不因 provider 变化                                 | 待执行                                                                              | SIMULATED                                                 | `packages/storage/src/owner-continuity.test.ts`                    |
| 12  | 已登录 User A                     | 绑定已属于 User B 的 Google / 邮箱            | 明确失败「该登录方式已经关联其他账号。」；不合并、不新建第三个 user、不动 B | 待执行                                                                              | SIMULATED                                                 | `adapter.test.ts` 10.、22.、23.                                    |

## 4. OTP 与安全矩阵（真实环境需覆盖）

| 场景                   | 期望                                               | 状态                               |
| ---------------------- | -------------------------------------------------- | ---------------------------------- |
| 错误验证码             | 「验证码不正确或已过期，请重新获取。」，无 session | SIMULATED（`adapter.test.ts` 26.） |
| 过期验证码             | 「验证码已过期，请重新获取。」，无 session         | SIMULATED（`adapter.test.ts` 27.） |
| 重发                   | UI 60s 倒计时；provider 侧频率限制生效             | SIMULATED（`adapter.test.ts` 28.） |
| 限流                   | 「…请稍后再试。」，不暴露内部实现                  | SIMULATED（`adapter.test.ts` 29.） |
| 短信通道未配置         | `SMS_PROVIDER_NOT_CONFIGURED`，明确外部状态        | SIMULATED（`adapter.test.ts` 30.） |
| 未登录调用 link/unlink | 「请先登录账户后再操作。」                         | SIMULATED（`adapter.test.ts` 25.） |
| 解除最后一个登录方式   | 拒绝并提示至少保留一种登录方式                     | SIMULATED（`adapter.test.ts` 11.） |

## 5. 已知限制

1. **密码状态**：Supabase Auth 客户端 API 不暴露「是否已设置密码」，`密码 [已设置/未设置]` 是本设备提示（localStorage + 内存兜底），不是服务端权威值。文档与 UI 均标注为本机判断。
2. **Google / 邮件 / 短信** 三项真实登录依赖外部配置，未配置前对应行保持 `BLOCKED BY EXTERNAL CONFIGURATION`，不得标记为失败。
3. 本阶段**未发送任何真实短信 / 邮件 / OAuth 请求**，全部为 fake provider 自动测试。

## 6. 执行记录（2026-09-27，真实环境）

| 步骤                                                    | 结果                              | 证据                                                                                                                                                                                                          |
| ------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 迁移 `001`→`004` 应用到真实 Supabase Postgres           | VERIFIED REAL                     | `Applied 001_initial.sql … 004_reminder_delivery.sql`；`pg_tables` 见 20 张表                                                                                                                                 |
| `real-postgres.integration.test.ts`（此前长期 skipped） | **VERIFIED REAL：1 passed**       | vitest 输出 `Test Files 1 passed`                                                                                                                                                                             |
| `verify:live-api` 真实 JWT → 认证 API                   | VERIFIED REAL                     | `Live API verified for owner d54867cf-c632-4597-bd9a-c7a89b5f6ea0; change page size 0`                                                                                                                        |
| 邮箱+密码注册/登录（Confirm email 已关闭）              | VERIFIED REAL                     | `POST /auth/v1/signup` 200 + session；测试账号 `cm-auth-test-20260927@gmail.com`                                                                                                                              |
| 浏览器真实登录 → 记录 → 同步 push                       | VERIFIED REAL                     | 真实账号 owner `645027f0-7b61-480d-9b3d-9c1ad264ee45`；`items` 1 行「明天买东西」(INCOMPLETE, created 2026-09-27T09:16:25Z)；`change_log` 6 行（RAW_CAPTURE CREATE → RAW_CAPTURE_DECISION CREATE → RESOLVED） |
| Email OTP / Phone OTP / Google / Linking                | BLOCKED BY EXTERNAL CONFIGURATION | SMTP、SMS Provider、Google Client 未配置；Manual Linking 已开启待真实 link 验证                                                                                                                               |
| 两个独立 browser profile 同步收敛                       | NOT RUN                           | 待执行                                                                                                                                                                                                        |
