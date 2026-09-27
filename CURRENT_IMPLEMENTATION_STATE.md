# Current Implementation State

**复核日期**：2026-09-26（换机后在新机器复验）

**功能/验收基线**：`1dcdf18 Record Phase 8 acceptance audit`

**换机复验（2026-09-26，Windows 11 / Node v24.19.0 / pnpm 11.25.0）**：`pnpm install --frozen-lockfile`、`pnpm test`、`pnpm build`、`pnpm lint`、`pnpm format:check`、`git diff --check` 全部通过。当时快照为 97 passed + 1 skipped，随后进入 Release Candidate Hardening，最新 gate 见 §2 与 §9。真实 PostgreSQL 测试仍按预期 skipped（缺 `REAL_DATABASE_URL`），未计为 PASS。

**当前阶段**：Phase 6 工程实现与 Phase 7A–7H 已封存；Phase 8 本地 acceptance/hardening 已逐项执行。真实基础设施、真实 AI provider、平台通知和物理设备验证仍是独立发布 gate。

本文以当前代码、实际执行的测试和当前机器可用环境为准。PGlite/fake IndexedDB 证据与真实 PostgreSQL/Supabase 证据严格分开。

## 1. 当前已实现并可运行

- pnpm/TypeScript workspace、React/Vite Web、Fastify API、PostgreSQL migration、Dexie 本地库和 Vitest 基础可 install/build/test/run。
- Quick Capture 先在同一 Dexie 事务保存 RawCapture 与 outbox，再做解析；网络、AI 或解析失败不丢原文。
- Semester、Course、CourseInformation、Item、RawCapture、RawCaptureOutput、RawCaptureDecision、ItemAssociation 的正式本地/同步链路已接通；正式 REST 已补齐 Course PATCH、CourseInformation 写入、unresolved RawCapture 删除、ItemAssociation create/list/delete。
- Overview、Course、Calendar、Search/Reminder 基础数据使用同一 Item identity；Calendar 只投影 Item，不读取 CourseSchedule。
- Item 编辑、完成/恢复、删除确认、限时 Undo；课程删除两种策略；跨学期候选确认；人工 SemesterWeek/CourseSchedule 整组维护均可运行。
- CourseSchedule 与 SemesterWeek 的新写入各产生一条 collection outbox command。服务端使用 owner-scoped parent、collection version、替换前集合 hash、单 PostgreSQL 事务、canonical client IDs、单 change-log envelope 和幂等结果；pull 在一个 Dexie 事务内应用整组与 cursor。
- 两端并发替换形成 collection conflict；Conflict UI 将其显示为完整本机组与完整已同步组，不混合成员，不显示版本号、mutation ID、SQL 或 outbox 内部数据。
- Semester、Course、Item、CourseInformation、RawCapture 的同字段并发形成字段冲突；非重叠字段自动合并。UI 支持选择 LOCAL、REMOTE 或适合字段类型的显式值。已删除对象不能经冲突接口任意恢复。
- ACTION_REQUIRED 有完整用户出口：显示受影响对象和可读原因；允许时用当前本地内容、新 mutation ID 与已知服务器版本重交；或经二次确认采用已同步状态。repair decision 记录旧/新 mutation、被替代 mutation、动作、设备与原错误。
- 过期 Undo 不能重交为 undelete，只能明确采用已同步 tombstone；放弃 collection replacement 时恢复替换前整组并重置 pull cursor；任何路径都不静默删除 RawCapture。
- outbox 顺序、owner binding、pull cursor、idempotency、change log、tombstone、stale guard、冲突恢复和服务端 commit 后响应丢失的重试语义已实现。
- Dexie v6 会将旧版 SemesterWeek/CourseSchedule 逐成员 pending outbox 合并为 parent-scoped collection command。可恢复数据保留完整 previous/desired snapshot；无法证明 parent 的旧删除进入 ACTION_REQUIRED，worker 不会把它作为半组变更上传。
- 确定性/AI 候选解释边界、多事项拆分确认、provenance，以及可配置 Reminder Engine/本地派生计划已实现；仍有各自的真实 provider/platform gate。
- Phase 7A–7H 已完成 tokenized shell、Windows/Mobile navigation、Overview/Course/Item hierarchy、全局 Quick Capture、Windows 单 detail container、Mobile Bottom Sheet、同容器 edit、完成/删除/Undo motion、Calendar month/week/day、全局 Search、attention/account 状态 surface、统一 Motion System 与最终 responsive/accessibility refinement。
- 详情快速对象切换使用 request/ref guard，过期 RawCapture、association 或 refresh 结果不能覆盖当前选择；完成、恢复与删除 Undo 保持同一 Item identity。
- Calendar 使用传统七列月/周投影、连续多日 range 与按时间排序的 Single Day；移动端使用日期 → Single Day → Item Bottom Sheet，且从未读取 CourseSchedule。
- Course Import 已实现 recoverable job → source parse → persisted preview → explicit duplicate decision → atomic commit；同文件/学期重复导入幂等，失败解析不写部分 Course。SAME_COURSE 只继承前一学期 CourseInformation，不复制历史 Item 或旧 CourseSchedule；导入的新 schedule 才写入新 Course。
- Search 在本地规范化关键词后匹配 Item、Course 与 CourseInformation，按类型分组、保持源顺序且不做 AI 排名；结果直接进入现有详情、课程或课程信息位置。
- unresolved、Conflict 与 ACTION_REQUIRED 现在使用统一可展开摘要；AccountControl 明确区分仅本机、离线、同步中、已同步、需检查和错误，同时不暴露 outbox 等内部机制。
- 页面、课程详情、tab、Completed、Quick Capture、Search、Account 与 Detail 使用同一组短 motion token；关闭 surface 会先离场再卸载。reduced-motion 同时关闭显著 CSS 位移和 JavaScript 退出等待。
- Calendar 改期根据同一 Item 的投影位置变化显示短到达提示，不重挂整张日历；Quick Capture 的局部成功提示保持输入焦点，并避免与全局 toast 重复播报。
- `360–1440px` 断点矩阵无水平溢出；Mobile 可见操作目标达到约 44px，Bottom Sheet 具备 modal/Tab loop，分层 Escape 不再误关底层空间，跨断点保持同一 Item identity。完整证据见 `docs/RESPONSIVE_ACCEPTANCE_MATRIX.md`。

## 2. 已有自动测试证据

当前完整套件在 Final Release Gate Preparation 最终 gate 重新执行：**144 项通过，1 项真实 PostgreSQL 测试因缺少 URL 跳过**。

- domain：11 passed；
- application：17 passed；
- storage：32 passed；
- API：49 passed，1 skipped；
- Web：35 passed。

Phase 6 的自动证据包括：

- collection command 单 outbox、幂等 replay、stale version、替换前快照、owner isolation、单 envelope 和整组 conflict；
- 无效 envelope 的 Dexie 全事务 rollback、cursor 不前进、解决后更晚本机整组替换不被覆盖；
- ACTION_REQUIRED 当前内容重交、新 idempotency identity、过期 Undo 明确放弃和 repair provenance；
- ItemAssociation canonical pair、双向读取、重复阻止、tombstone 与不同步 Item 状态；
- Semester/Course/Item/CourseInformation/RawCapture 的 merge/conflict/version 行为；
- 两个独立 Dexie 数据库经 Fastify + PGlite 完成 A–I 与 K；J 通过受控 pull overlap 测试；
- commit 后丢失响应时使用相同 mutation ID，RawCapture/Item 不重复；
- fake IndexedDB v5 → v6 migration rehearsal：旧 row outbox 折叠为单条整组 command、当前数据不丢失、旧记录保留 superseded provenance、后续只上传 collection command；不可还原旧删除会被隔离且不会上传；
- Web 不显示 mutation、base version 或内部错误，并为字段冲突提供显式值入口、为 collection conflict 只显示组数量。
- Web surface 测试覆盖导航、Course/Item 层级、Quick Capture 单控件 identity、Detail 内容与 mobile modal 语义、删除/恢复 motion state、Calendar 连续 range/Single Day/位置签名、Search 分组、attention/account 状态、共享 motion timing 与 transient notice 语义；`360–1440px` 关键流程已通过浏览器人工验收。
- Phase 8 的逐 ID 状态、自动/人工/模拟/外部证据与 release gate 见 `docs/ACCEPTANCE_TRACEABILITY.md`。

完整逐场景证据见 `docs/MULTI_DEVICE_VERIFICATION.md`，逐实体能力见 `docs/SYNC_ENTITY_MATRIX.md`。

## 3. 代码存在，但尚无真实环境验收

- 正式 `pg` 连接、迁移器、开发 seed 和隔离 schema 集成测试已准备；2026-09-27 起 `.env` 已提供真实连接：`001`–`004` 四份 migration 已应用到真实 Supabase Postgres，`real-postgres.integration.test.ts` **1 passed（不再是 skipped）**。
- Supabase JWT/JWKS 验证、浏览器 Auth 登录/会话监听、受保护 API 和只读 live smoke script 已准备；`.env` 已有项目 URL 与 publishable key（JWKS 可达、认证业务路由已注册），但 SMTP / SMS Provider / Google OAuth 未配置、无测试账号与 access token，真实登录链路仍未执行。
- 双设备测试使用两个独立 Dexie 数据库与正式 worker/HTTP route，但数据库仍是同进程 PGlite，认证仍是固定测试 owner；不是两个物理设备或真实网络生命周期验收。
- MiMo interpretation 与 PDF/image Course Import provider、strict structured output 校验存在；真实 MiMo（`mimo-v2.6-flash`，OpenAI 兼容 Chat Completions）interpretation 与 scanned-PDF import smoke 已 PASS，生产长期稳定性仍待持续观察。
- Reminder claim/deliver/cancel port、本地计划与数据库表存在；没有真实 Windows/Mobile 通知、后台执行、云端 lease API 或时区切换验收。

## 4. 当前真正未实现或未闭合

### Phase 6 / 外部验收

- 在真实 PostgreSQL 运行 migration 与 `real-postgres.integration.test.ts`。
- 在真实 Supabase 完成 login → authenticated API → capture/outbox/push/pull/conflict/resolve/restart/convergence。
- 双独立浏览器 profile 的**基本双向同步已真实通过**（见 §11 VERIFIED REAL）；仍缺：断网、后台恢复与长时间重试验收，以及物理设备矩阵。

### 发布

- 真实设备上的系统通知、后台执行与长周期 lease 实机验收；R-01 已固化为产品 v1 policy，device registration、claim/lease、delivery acknowledgement 与浏览器通知适配器已实现并通过自动测试。
- 真实 AI interpretation/import provider、完整自然语言时间理解。
- 物理手机、Windows 设备、屏幕阅读器、系统缩放与移动软键盘验收。

## 5. 已刷新或应废弃的旧审计描述

- “Web 缺少账号入口”已过时：已有 AccountControl 和 Supabase 会话适配器，缺的是外部项目验收。
- “尚无冲突读取/解决 UI”已过时：字段与 collection conflict 均有 UI，且支持显式值；缺的是线上双设备验收。
- “CourseSchedule/SemesterWeek 仍逐实体 outbox”已过时：所有新替换均使用单 collection command。
- “ACTION_REQUIRED 只能重跑整轮同步”已过时：现有逐 mutation 检查、重交/明确放弃和 provenance。
- “ItemAssociation 只有类型和表”已过时：本地 use case、REST、sync create/delete/pull 和测试已闭合。
- “Course/CourseInformation 正式写 API 缺失”已过时：当前接口已补齐。
- 26/35/44/48/64/66/72/75/82/87/88/92/96/97/112 等数字是历史阶段快照，不能代表当前覆盖；当前 gate 使用 144 passed + 1 externally gated skip。

`docs/IMPLEMENTATION_AUDIT.md` 已按 Implemented、Verified locally、Verified simulated、Verified real、Not implemented、Blocked、Release blocker 重新整理。

## 6. Phase 8 状态与剩余 release gate

1. **EXTERNAL CONFIGURATION REQUIRED**：真实 PostgreSQL 连接与 Supabase 项目/测试用户/token 缺失，无法产出真实基础设施证据。
2. **ENVIRONMENT VERIFICATION REQUIRED**：尚未在两个独立浏览器 profile 或物理设备执行 A–K 的网络/生命周期验收。
3. **R-01 已解决**：提醒数值固化为产品 v1 policy（`packages/application/src/reminderPolicy.ts`，version `r01-v1`），安静时段 23:00–08:00，`VITE_REMINDER_POLICY` 仅作覆盖。**剩余实机 gate**：真实设备上的平台通知、后台执行与长周期 lease。
4. **真实 AI smoke 已完成**：`pnpm verify:ai` → `PASS interpretation 28240ms`；`pnpm verify:ai --with-import` → `PASS import 37633ms courses=3`（MiMo `mimo-v2.6-flash`，扫描 PDF 走栅格化路径）。剩余：完整自然语言时间理解继续走保守确认路径，生产稳定性需持续观察。
5. **PHYSICAL ACCESSIBILITY VERIFICATION REQUIRED**：屏幕阅读器、系统缩放与移动软键盘尚未实机执行。

旧逐成员 collection outbox 的可重复 fake IndexedDB v5 → v6 演练已经完成；当前没有未闭合的 Phase 6 本地工程 blocker。

> **PHASE 6 ENGINEERING IMPLEMENTATION: COMPLETE**

> **PHASE 7A–7H: PASS LOCALLY**

> **PHASE 8 LOCAL ACCEPTANCE: PASS WITH EXTERNAL RELEASE GATES**

真实外部基础设施仍未验证：

> **RELEASE INFRASTRUCTURE VERIFICATION: BLOCKED BY EXTERNAL CONFIGURATION**

## 7. 新 agent 接手入口

### 先读什么

1. 本文件，确认当前真实状态和 release gates。
2. `docs/ACCEPTANCE_TRACEABILITY.md`，查看 `19_TEST_ACCEPTANCE_SPEC.md` 的 71/71 ID 映射。
3. `docs/IMPLEMENTATION_AUDIT.md`，查看 Phase 1–8 的实现边界和证据等级。
4. 进入 sync 工作前读 `docs/ADR-003-sync-core.md`、`docs/ADR-004-conflict-resolution.md`、`docs/ADR-005-collection-replacement-sync.md` 与 `docs/SYNC_ENTITY_MATRIX.md`。
5. 进入真实环境验收前按 `docs/REAL_POSTGRES_VERIFICATION.md` 执行，不用 PGlite 结果替代真实证据。

### 下一步

1. ~~Reminder delivery engineering~~ 已完成（见 §8）；R-01 已按产品指令固化为 v1（见 §9）。下一步是外部环境验收 lane：真实 PostgreSQL / Supabase / 双 browser profile / 物理设备矩阵。
2. **External integration lane**：拿到配置后依次运行四份 migration、`pnpm test:postgres`、真实 Supabase 登录/同步、两个独立 browser profile 和物理设备矩阵（执行步骤见 `docs/FINAL_RELEASE_VALIDATION.md`；真实 MiMo interpretation/import smoke 已完成）。
3. ~~Release optimization~~ 主 bundle warning 已在 RC Hardening 内用零行为变化的 vendor 分包解决（entry 555.89 → 348.28 kB，react-vendor 独立 218.83 kB）；更深度的按路由懒加载记入 §10 技术债。

### 本轮关键决定

- Course Import 采用 recoverable job：源文件只在 parse request 中使用，长期保存 normalized preview、source hash/name/media type、用户 duplicate decisions 和 commit result；不长期保存原始字节。
- 跨学期同名只产生 owner-scoped candidate；SAME_COURSE 必须由用户明确选择，只继承 CourseInformation，不复制历史 Item 或旧 CourseSchedule。
- 导入 commit 使用 transaction + Idempotency-Key + `(owner, semester, source hash)` 去重；失败解析不写部分 Course，重启可从 preview checkpoint 继续。
- Phase 8 的 PASS 只表示本机自动测试、浏览器检查和模拟基础设施成立；外部服务与物理环境继续单独标记，不提升为 production PASS。

### 已知坑与命令边界

- **现象**：普通 `pnpm test` 显示 1 skipped，而 `pnpm test:postgres` 在同一机器直接失败。**原因**：前者允许缺少 `REAL_DATABASE_URL` 时跳过真实 PostgreSQL 文件，后者是显式外部 gate。**解决**：本地回归使用 `pnpm test`；只在提供可丢弃真实数据库后运行 `pnpm test:postgres`，不得把 skipped 写成真实 PASS。
- **现象**：当前环境直接执行 `pnpm exec prettier ...` 报找不到命令。**原因**：本机 pnpm command shim 没有通过该调用解析 root dev binary。**解决**：使用已验证的项目脚本 `pnpm format` 或 `pnpm format:check`。
- **现象**：旧验证文档只列两份 migration。**原因**：Course Import 后新增 `003_course_import.sql`，历史说明未同步。**解决**：文档已修正；真实数据库必须依次应用 `001_initial.sql`、`002_collection_sync.sql`、`003_course_import.sql`、`004_reminder_delivery.sql`。
- **现象**：无外部配置时 API 只有 health，Course Import 不能上传解析。**原因**：认证业务路由要求同时配置 `DATABASE_URL` 与 `SUPABASE_URL`，provider 另需 `AI_API_KEY`（MiMo）。**解决**：本地继续使用 IndexedDB、确定性解析和手工 Course/CourseSchedule；外部 lane 按 `docs/REAL_POSTGRES_VERIFICATION.md` 配置。
- 仓库当前没有 Git remote，结项没有 push。新增 remote 或发布目标前先由总控确认。

### 当前风险与需要总控提供的输入

- ~~需要产品拍板：R-01 Numeric Reminder Policy~~ 已于 2026-09-26 固化为产品 v1 policy。
- **需要外部配置**：可丢弃的真实 PostgreSQL、Supabase project/test user/token（MiMo key 已就位并通过 smoke）。
- **需要实机资源**：Mobile/Windows 设备、两个独立 browser profile、屏幕阅读器、系统缩放与移动软键盘环境。
- 当前未发现 P0 规格冲突、未提交有效代码、调试残留、个人绝对路径或误跟踪密钥。

## 8. 换机后本轮新增（2026-09-26）

- **AI provider 换为 MiMo（不调用 GPT）**：`apps/api/src/ai/chat-provider.ts` 与 `course-import-chat-parser.ts` 改用 OpenAI 兼容的 Chat Completions 接口，默认 `AI_BASE_URL=https://api.xiaomimimo.com/v1`、`AI_MODEL=mimo-v2.6-flash`；旧 `openai-provider.ts` / `course-import-provider.ts`（Responses 接口）已删除。环境变量 `AI_API_KEY`/`AI_MODEL`/`AI_BASE_URL`，并兼容旧名 `MIMO_*` / `OPENAI_*`。解释与导入均使用 strict `response_format: json_schema`，已对真实 endpoint 各跑通一次（解释约 40 s，图片导入约 36 s）。
- **PDF 导入改为服务端提取页文字**：MiMo 只接受 bmp/gif/png/jpeg/webp，`file` 输入返回 400；因此 PDF 用 `pdfjs-dist` 提取页面文本后随 prompt 发送，提取不到文字时明确报错，不再伪装成功。图片仍走 base64 `image_url`。
- **Reminder delivery engineering**：新增 `backend/migrations/004_reminder_delivery.sql`（`devices` 与 `notification_deliveries` 增列：`logical_key`、`state`、lease、ack、cancel 等），`apps/api/src/db/notifications.ts` 提供 device registration、跨设备 claim/lease、delivery acknowledgement 与按 key 取消，服务端 claim 自带 stale guard（完成/删除/静音 → CANCELED）；新增路由 `POST /api/v1/devices`、`POST /api/v1/notifications/claim`、`POST /api/v1/notifications/{id}/delivered`、`POST /api/v1/notifications/cancel`。
- **Web 交付实现**：`apps/web/src/reminders.ts` 提供 `BrowserNotificationAdapter`（平台通知、点击打开当前 Item 并消费该次通知、无权限回退应用内提示、首次手势申请权限）、`WebReminderDeliveryPort`（在线走服务端 lease + ack，离线/未登录本地交付）、`ReminderScheduler`（reconcile + deliverDue，防重入）；`App.tsx` 在注入策略后启动，15 s 轮询、页面可见与每次 `refresh()` 后触发，完成/删除/改期的取消因此立即生效。
- **新增自动测试**：`apps/api/src/db/notifications.test.ts`（4）、`apps/web/src/reminders.test.ts`（8）、`packages/application/src/reminders.test.ts` 的 `createReminderWindow`（2）；该轮总数 97 → 112 passed + 1 skipped（RC Hardening 后 136 + 1，Final Release Gate Preparation 后 144 + 1，见 §9）。
- **提醒策略当时仍由配置注入**：该轮 R-01 未定，引擎默认不启动；RC Hardening 期间已按产品指令固化为 v1，见 §9。

## 9. Release Candidate Hardening（2026-09-26）

本阶段不是功能新增，目标是把“本地 acceptance 通过”推进为“具备真实环境验收条件的 RC”。范围冻结：不新增规格外产品功能、不重开 Phase 7、不重构 App.tsx（见 §10 技术债）。

### IMPLEMENTED

- **扫描版 PDF fallback**：`preparePdfSource()` 按页判断文本层，无可信文本的页栅格化为受控 JPEG（≤1600px / q72，总图 ≤6MB，≤8 页，单请求 ≤4 图分批），结果按课程名合并；超页数/超扫描页/超 payload 给出中文产品文案，job 保持可恢复。详见 `docs/ADR-006-scanned-pdf-import.md`。
- **Provider 边界**：`ProviderError` 分类（AUTH/RATE_LIMITED/TIMEOUT/UNAVAILABLE/INVALID_REQUEST/MALFORMED）+ 仅瞬时错误重试一次；导入 300s、解释 90s 超时；解释与导入共用 strict `json_schema`。
- **失败文案**：`importFailureMessage()` 与 Web `toUserMessage()` 把工程消息映射为产品语言，UI 不再出现 mutation/row_version/outbox/SQL/状态码。
- **R-01 固化**：`REMINDER_POLICY_V1`（version `r01-v1`）——NORMAL due 24h/2h、same-day 6h、上限 3/天、逾期 24h、occurrence 前 30min、occurrence 后 24h 且每日一次；HIGH due 24h/4h/1h/15min、same-day 3h、上限 5/天、逾期 6h、occurrence 前 1h/15min、occurrence 后 8h 再每 12h；start 恰好一次；dedup 60min；quiet hours 23:00–08:00。引擎支持 same-day cadence、per-level daily budget、occurrence-after initial offset；“提醒我”默认 HIGH（`reminderLevelForCapture`）。
- **安静时段同时约束交付**：`ReminderScheduler.tick()` 在 `window.nextAllowedTime(now) > now` 时只做 reconcile 不发送，夜间到点的提醒顺延到 08:00 之后，而不是在安静时段打断（浏览器实测 23:21 本地时间 0 条发送）。
- **真实 provider smoke 入口**：`pnpm verify:ai [--with-import]`，无密钥时输出 `REAL_AI_REQUIRED` 并以退出码 2 结束，绝不伪造 PASS。

### VERIFIED LOCALLY

- `pnpm test`：**136 passed + 1 skipped**（historical snapshot：Release Candidate Hardening 阶段数字，domain 11、application 17、storage 32、web 35、API 41 + 1 真实 PostgreSQL skip；当前最终 gate 144 + 1 见 §2 与 §10）。
- `pnpm build`：PASS；主 chunk 由 555.89 kB 降为 **348.28 kB**，react-vendor 218.83 kB 独立分包，Vite >500kB warning 消失（仅配置级 `codeSplitting`，行为不变）。
- `pnpm lint` / `pnpm format:check` / `git diff --check`：PASS。
- 新增覆盖：扫描 PDF fallback、栅格化/页数/payload 限制、不可读文件、超大导入（15MB）、provider 不可用/超时/401/非 JSON、瞬时失败重试、batch 合并去重、R-01 全部 10 项行为、产品错误文案、`reminderLevelForCapture`。

### VERIFIED REAL

- `pnpm verify:ai --with-import`：`PASS interpretation 28240ms`（MiMo mimo-v2.6-flash，strict json_schema）、`PASS import 37633ms courses=3`（2 页扫描 fixture 全程栅格化路径）。

### BLOCKED BY EXTERNAL CONFIGURATION

- 真实 PostgreSQL（`REAL_DATABASE_URL`）与 Supabase 项目/测试账号/token。
- 两个独立 browser profile / 物理设备的同步与通知生命周期。

### NOT RUN PHYSICAL

- 物理手机与 Windows 设备上的系统通知、后台执行、屏幕阅读器、系统缩放、移动软键盘。

### RELEASE BLOCKER

- 无新增 P0；剩余发布阻塞为上述外部配置与实机矩阵。

### 技术债（本阶段明确不做）

- **POST-RELEASE TECHNICAL DEBT**：`apps/web/src/App.tsx` 体量大，暂不重构（未发现 correctness bug 或 state race）。
- **POST-RELEASE PERFORMANCE OPTIMIZATION**：进一步按路由懒加载与依赖裁剪（本轮只做了零行为变化的 vendor 分包）。
- 规格 `16_API_CONTRACT.md` §22 要求的 AI 端点 rate limit 尚未实现（单用户本地部署，风险低），留到发布前安全复核。
- AI 端点 quiet-hour / 通知权限的系统级设置 UI 尚未提供（当前 quiet hours 为产品默认值，通知权限走浏览器手势申请）。

## 10. Final Release Gate Preparation（2026-09-26）

### IMPLEMENTED

- **AI endpoint rate limit（规格级安全缺口，已关闭）**：`apps/api/src/rateLimit.ts` 固定窗口限流，只在真正调用 provider 前判定；桶键为 authenticated owner；`main.ts` 注入解释服务与导入服务共用同一预算。默认 `AI_RATE_LIMIT_PER_OWNER=20` / `AI_RATE_LIMIT_WINDOW_MS=60000`（**security default，可配置，不是产品行为**；规格 16 §22/14 §2.5/18 要求限流但未给数字）。触发返回 **429 + `RATE_LIMITED` + `Retry-After`**，文案“请求过于频繁，请稍后再试。”，无副作用：解释限流不改 RawCapture、不建 Item；导入限流不写 FAILED、不 commit。确定性解析路径不扣配额，普通 capture/sync 接口完全不受影响。详见 `docs/ADR-007-ai-rate-limit.md`。
- **Notification settings 判定（不新增 UI）**：复核 `06_REMINDER_POLICY` §12、`17_SYNC_NOTIFICATION_ENGINEERING` §17、`产品真相基线` §62、`11/13/19` —— 规格只要求“尊重设备安静时段”“用户无需管理这些延后细节”，**没有**要求用户可设置 quiet hours 或通知偏好 → 结论 B：quiet hours 用 R-01 v1 产品默认（23:00–08:00），通知权限走平台原生流程（浏览器手势申请 + 无权限回退应用内提示），用户级自定义记为未来 enhancement。
- **Provider 响应分类加固**：真实 smoke 曾出现一次 `MALFORMED`（间歇）。响应读取统一为 `readStructuredResponse()`：非 JSON 正文→`UNAVAILABLE`（瞬时，重试）、`finish_reason=length`→`TRUNCATED`（提示拆分，不重试）、空 content→`EMPTY`（瞬时，重试）、content 非 JSON→`MALFORMED`（不重试）；`importFailureMessage()` 为每类给出中文产品文案。
- **`docs/FINAL_RELEASE_VALIDATION.md`**：真实 PostgreSQL / Supabase / 双独立 browser profile（14 步）/ 物理 Windows / 物理移动端 / 屏幕阅读器的可执行跑道，每项含 Initial state·Operation·Expected·Actual·Result·Evidence。

### VERIFIED LOCAL

- `pnpm test`：**144 passed + 1 skipped**（domain 11、application 17、storage 32、web 35、API 49 + 1 真实 PostgreSQL skip）；`pnpm build`、`pnpm lint`、`pnpm format:check`、`git diff --check` 全部 PASS。
- 新增 8 项限流测试：`rateLimit.test.ts`(5)、`ai/interpretation-rate-limit.test.ts`(2)、`db/course-import.test.ts`(1)。

### VERIFIED REAL

- `pnpm verify:ai` → `PASS interpretation`；`pnpm verify:ai --with-import` → `PASS import … courses=3`（MiMo `mimo-v2.6-flash`）。

### 状态结论

> **FINAL RELEASE GATE PREPARATION: COMPLETE**

剩余 release gates 全部属于外部环境（见 `docs/FINAL_RELEASE_VALIDATION.md`）：真实 PostgreSQL、Supabase、双独立 browser profile、物理设备与屏幕阅读器；R-01 与真实 AI provider 均已完成，不再是 gate。

## 11. Account / Authentication v1（2026-09-27）

### 冻结的账户模型

`ONE HUMAN → ONE COURSE MANAGER ACCOUNT → ONE auth.users.id`。`auth.users.id` 是 Course / Item / RawCapture / Reminder / Sync / Conflict 的唯一 owner；一个 user 可挂多个 authentication identities（手机号 / 邮箱 / Google）与凭证（OTP 或密码）。禁止用 email、phone、Google provider id 当 owner；同账户切换登录方式不迁移业务数据、不重绑 `local_owner_id` / `sync_bound_owner_id`。

### IMPLEMENTED

- **Auth adapter** `apps/web/src/auth/adapter.ts`：Email OTP（`signInWithOtp` + `verifyOtp type=email`，**不再是 magic link 主入口**）、Phone OTP（`type=sms`）、Email/Phone + 密码登录与注册、Google OAuth 登录与 `linkIdentity` 绑定、`updateUser` 绑定邮箱/手机号 + 对应 verification OTP、设置/修改密码、`resetPasswordForEmail` + recovery OTP 完成重置、`getUserIdentities` / `unlinkIdentity`（≥2 identity 才允许）、登录态监听。所有出口只暴露 `AuthAccount.userId = auth.users.id`。
- **错误映射** `apps/web/src/auth/errors.ts`：Supabase 错误码 → 产品文案（重复 identity、验证码错误/过期、限流、未登录、密码强度…），不泄漏内部实现；`SMS_PROVIDER_NOT_CONFIGURED` 作为明确的外部环境状态。
- **手机号** `apps/web/src/auth/phone.ts`：E.164 归一化 + 国家/地区选择（默认 +86，模型不锁死中国大陆）。
- **登录 UI** `apps/web/src/auth/SignInPanel.tsx`：PRIMARY 手机号验证码 → SECONDARY Google → TERTIARY 邮箱（验证码 / 密码 / 忘记密码），第一屏不平铺五个按钮。
- **身份管理 UI** `apps/web/src/auth/AccountIdentities.tsx`：登录方式列表（已验证 / 未验证 / 未绑定）、绑定与验证、设置/修改密码、忘记密码、解除绑定（遵循 Supabase ≥2 identity 约束，保住最后一条登录路径）。
- **接线**：`authSync.ts` 导出 `authAdapter` 并移除旧魔法链接入口 `sendSignInLink`；`AccountControl.tsx` 登录态改为 `AuthAccount`，并把 OAuth / recovery 回跳错误（如 `identity_already_exists`）一次性提示后清理 URL。
- **数据库变更**：无；密码、哈希、凭据从不进入 Course Manager 数据库。
- **文档**：`docs/AUTH_REAL_VALIDATION.md`（架构、改动文件、Supabase Dashboard 配置清单、12 项真实验收表、OTP 安全矩阵、已知限制）；`README.md` 登录描述已更新。

### VERIFIED LOCAL

- `pnpm test`：**184 passed + 1 skipped**（domain 11、application 17、storage 35、web 72、API 49 + 1 真实 PostgreSQL skip）；shell 中导出 `REAL_DATABASE_URL` 后为 **185 passed + 0 skipped**；`pnpm build`、`pnpm lint`、`pnpm format:check`、`pnpm typecheck` 全部 PASS。
- 新增测试：`apps/web/src/auth/phone.test.ts`(4)、`adapter.test.ts`(30，覆盖规格 §15 的 1-19、22-30)、`SignInPanel.test.tsx`(4)、`packages/storage/src/owner-continuity.test.ts`(3，覆盖 owner 连续性与跨 owner 隔离)。全部使用 fake provider，不发送真实短信/邮件。
- 浏览器实测（真实 Supabase client 注入 `.env` 配置）：打开「账户与同步」即手机号验证码主入口（国家默认 +86），Google 次之、邮箱第三级；切换邮箱分支渲染正常，无控制台报错。

### VERIFIED REAL（2026-09-27）

- 四份 migration 已应用到真实 Supabase Postgres；`real-postgres.integration.test.ts` **1 passed**（原 skipped 项）。
- `verify:live-api` → `Live API verified for owner d54867cf-…`（真实 JWT → 认证 API → 真实 change page）。
- 浏览器真实邮箱+密码注册/登录 → 记录「明天买东西」→ push 落库：`items` 1 行（owner `645027f0-…`）、`change_log` 6 行（capture → decision → resolved）。证据见 `docs/AUTH_REAL_VALIDATION.md §6`。
- **两个独立 browser profile 双向同步 VERIFIED REAL**：原窗口与 InPrivate 窗口互登同一账号、互见两条待办；服务端 `devices` 2 个 device、`items` 2 行、`sync_conflicts` 0。
- **Google OAuth VERIFIED REAL（2026-09-27）**：Dashboard 凭据 + `external.google=true`；同邮箱**自动合并**进原用户（Case A，登录后 3 条数据仍在）、**重复身份拒绝**（Case C，163 账号绑已占用的 Google → 提示「该登录方式已经关联其他账号。」，服务端 identities 未变、用户数不变）。
- **跨 owner 数据保护 VERIFIED REAL**：用另一账号登录时提示「本机记录已关联另一账户，请使用原账户」，本机数据不删不迁、云端该账号 `items`=0、界面进入「需要检查」。期间修复回跳错误不可见缺陷（`61595c8`：query+hash 解析 + 模块加载快照 + 自动弹开账户面板）。
- **离线记录 → 刷新不丢 → 恢复网络自动补传 VERIFIED REAL（C1–C3）**：本地 09:51:35 创建「离线测试不要丢」，服务端 09:52:34 收到 ITEM CREATE，全程未手动触发；`raw_captures` 3/3 RESOLVED、`items` 3 行无重复标题、`sync_conflicts` 0。仍缺：C5–C12 冲突场景、C13 关闭重开、C14 长时间重试。

- **Email OTP VERIFIED REAL（2026-09-27）**：用户在 Dashboard 配置 163 SMTP（`smtp.163.com:465`，Username 必须是完整邮箱地址，否则 `500 unexpected_failure`）并把 `Magic link or OTP` 模板改为 `{{ .Token }}` 后，发送验证码 → 输码 → 登录 → 同步全链路通过；退出后改用验证码重新登录，owner 仍为 `645027f0-…`，本机 3 条数据继续同步、未重绑。

### BLOCKED BY EXTERNAL CONFIGURATION

- Phone OTP：SMS Provider 未配置 → `SMS_PROVIDER_NOT_CONFIGURED`。
- Phone OTP：SMS Provider 未配置 → 运行时 `SMS_PROVIDER_NOT_CONFIGURED`。
- Google OAuth：Client ID / Secret 与 redirect URI 未配置。
- Manual Identity Linking：需在 Supabase Dashboard 开启，否则 `linkIdentity()` 返回 422。

> **AUTH V1 IMPLEMENTED**
> **SMS REAL PROVIDER: EXTERNAL CONFIGURATION REQUIRED**

配置清单与真实验收表见 `docs/AUTH_REAL_VALIDATION.md`。
