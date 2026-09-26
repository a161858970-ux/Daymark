# Current Implementation State

**复核日期**：2026-09-26（换机后在新机器复验）

**功能/验收基线**：`1dcdf18 Record Phase 8 acceptance audit`

**换机复验（2026-09-26，Windows 11 / Node v24.19.0 / pnpm 11.25.0）**：`pnpm install --frozen-lockfile`、`pnpm test`（97 passed + 1 skipped）、`pnpm build`、`pnpm lint`、`pnpm format:check`、`git diff --check` 全部通过，与本文记录一致。真实 PostgreSQL 测试仍按预期 skipped（缺 `REAL_DATABASE_URL`），未计为 PASS。

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

当前完整套件在本轮最终 gate 重新执行：**97 项通过，1 项真实 PostgreSQL 测试因缺少 URL 跳过**。

- domain：11 passed；
- application：4 passed；
- storage：32 passed；
- API：25 passed，1 skipped；
- Web：25 passed。

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

- 正式 `pg` 连接、迁移器、`001`–`003` 三份 migration、开发 seed 和隔离 schema 集成测试已准备；没有 `REAL_DATABASE_URL`，所以真实 PostgreSQL 测试未执行。
- Supabase JWT/JWKS 验证、浏览器 Auth 登录/会话监听、受保护 API 和只读 live smoke script 已准备；没有项目 URL、publishable key、测试账号/access token，所以真实登录链路未执行。
- 双设备测试使用两个独立 Dexie 数据库与正式 worker/HTTP route，但数据库仍是同进程 PGlite，认证仍是固定测试 owner；不是两个物理设备或真实网络生命周期验收。
- OpenAI interpretation 与 PDF/image Course Import provider、strict structured output 校验存在；没有真实模型 key/model/file 验收。
- Reminder claim/deliver/cancel port、本地计划与数据库表存在；没有真实 Windows/Mobile 通知、后台执行、云端 lease API 或时区切换验收。

## 4. 当前真正未实现或未闭合

### Phase 6 / 外部验收

- 在真实 PostgreSQL 运行 migration 与 `real-postgres.integration.test.ts`。
- 在真实 Supabase 完成 login → authenticated API → capture/outbox/push/pull/conflict/resolve/restart/convergence。
- 两个独立浏览器 profile/物理设备上的断网、后台恢复与长时间重试验收。

### 发布

- Reminder 云端 device registration、claim/lease、delivery acknowledgement 和平台通知；R-01 生产提醒数值仍是 release gate。
- 真实 AI interpretation/import provider、完整自然语言时间理解。
- 物理手机、Windows 设备、屏幕阅读器、系统缩放与移动软键盘验收。

## 5. 已刷新或应废弃的旧审计描述

- “Web 缺少账号入口”已过时：已有 AccountControl 和 Supabase 会话适配器，缺的是外部项目验收。
- “尚无冲突读取/解决 UI”已过时：字段与 collection conflict 均有 UI，且支持显式值；缺的是线上双设备验收。
- “CourseSchedule/SemesterWeek 仍逐实体 outbox”已过时：所有新替换均使用单 collection command。
- “ACTION_REQUIRED 只能重跑整轮同步”已过时：现有逐 mutation 检查、重交/明确放弃和 provenance。
- “ItemAssociation 只有类型和表”已过时：本地 use case、REST、sync create/delete/pull 和测试已闭合。
- “Course/CourseInformation 正式写 API 缺失”已过时：当前接口已补齐。
- 26/35/44/48/64/66/72/75/82/87/88/92/96 等数字是历史阶段快照，不能代表当前覆盖；当前 gate 使用 97 passed + 1 externally gated skip。

`docs/IMPLEMENTATION_AUDIT.md` 已按 Implemented、Verified locally、Verified simulated、Verified real、Not implemented、Blocked、Release blocker 重新整理。

## 6. Phase 8 状态与剩余 release gate

1. **EXTERNAL CONFIGURATION REQUIRED**：真实 PostgreSQL 连接与 Supabase 项目/测试用户/token 缺失，无法产出真实基础设施证据。
2. **ENVIRONMENT VERIFICATION REQUIRED**：尚未在两个独立浏览器 profile 或物理设备执行 A–K 的网络/生命周期验收。
3. **PRODUCT RELEASE GATE**：R-01 numeric Reminder Policy 尚未确定；平台 notification/lease 尚未接通。
4. **EXTERNAL AI VERIFICATION REQUIRED**：真实 OpenAI interpretation 与 PDF/image import 尚未执行。
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

1. **Reminder delivery engineering**：继续实现 device registration、claim/lease、delivery acknowledgement、completion/deletion/time-change cancellation 和平台 notification adapters。保持 `ReminderPolicy` 可配置，在 R-01 确定前不得写死生产数字。
2. **External integration lane**：拿到配置后依次运行三份 migration、`pnpm test:postgres`、真实 Supabase 登录/同步、两个独立 browser profile、真实 OpenAI interpretation/import file 和物理设备矩阵。
3. **Release optimization**：主功能闭合后再处理约 554 kB 的 Vite bundle warning；它当前不是 build failure，也不应通过删减产品 surface 解决。

### 本轮关键决定

- Course Import 采用 recoverable job：源文件只在 parse request 中使用，长期保存 normalized preview、source hash/name/media type、用户 duplicate decisions 和 commit result；不长期保存原始字节。
- 跨学期同名只产生 owner-scoped candidate；SAME_COURSE 必须由用户明确选择，只继承 CourseInformation，不复制历史 Item 或旧 CourseSchedule。
- 导入 commit 使用 transaction + Idempotency-Key + `(owner, semester, source hash)` 去重；失败解析不写部分 Course，重启可从 preview checkpoint 继续。
- Phase 8 的 PASS 只表示本机自动测试、浏览器检查和模拟基础设施成立；外部服务与物理环境继续单独标记，不提升为 production PASS。

### 已知坑与命令边界

- **现象**：普通 `pnpm test` 显示 1 skipped，而 `pnpm test:postgres` 在同一机器直接失败。**原因**：前者允许缺少 `REAL_DATABASE_URL` 时跳过真实 PostgreSQL 文件，后者是显式外部 gate。**解决**：本地回归使用 `pnpm test`；只在提供可丢弃真实数据库后运行 `pnpm test:postgres`，不得把 skipped 写成真实 PASS。
- **现象**：当前环境直接执行 `pnpm exec prettier ...` 报找不到命令。**原因**：本机 pnpm command shim 没有通过该调用解析 root dev binary。**解决**：使用已验证的项目脚本 `pnpm format` 或 `pnpm format:check`。
- **现象**：旧验证文档只列两份 migration。**原因**：Course Import 后新增 `003_course_import.sql`，历史说明未同步。**解决**：文档已修正；真实数据库必须依次应用 `001_initial.sql`、`002_collection_sync.sql`、`003_course_import.sql`。
- **现象**：无外部配置时 API 只有 health，Course Import 不能上传解析。**原因**：认证业务路由要求同时配置 `DATABASE_URL` 与 `SUPABASE_URL`，provider 另需 OpenAI key/model。**解决**：本地继续使用 IndexedDB、确定性解析和手工 Course/CourseSchedule；外部 lane 按 `docs/REAL_POSTGRES_VERIFICATION.md` 配置。
- 仓库当前没有 Git remote，结项没有 push。新增 remote 或发布目标前先由总控确认。

### 当前风险与需要总控提供的输入

- **需要产品拍板**：R-01 Numeric Reminder Policy。
- **需要外部配置**：可丢弃的真实 PostgreSQL、Supabase project/test user/token、OpenAI key/model。
- **需要实机资源**：Mobile/Windows 设备、两个独立 browser profile、屏幕阅读器、系统缩放与移动软键盘环境。
- 当前未发现 P0 规格冲突、未提交有效代码、调试残留、个人绝对路径或误跟踪密钥。
