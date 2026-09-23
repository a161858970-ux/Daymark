# Current Implementation State

**复核日期**：2026-09-24

**仓库基线**：`38f4f94 Establish course manager implementation baseline` 之后的当前工作树

**当前阶段**：Phase 6 — Offline / Sync / Conflict，**PARTIALLY COMPLETE**

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
- 确定性/AI 候选解释边界、多事项拆分确认、provenance，以及可配置 Reminder Engine/本地派生计划已实现；仍有各自的真实 provider/platform gate。

## 2. 已有自动测试证据

当前完整套件在本轮最终 gate 重新执行：**64 项通过，1 项真实 PostgreSQL 测试因缺少 URL 跳过**。

- domain：7 passed；
- application：4 passed；
- storage：28 passed；
- API：21 passed，1 skipped；
- Web：4 passed。

Phase 6 的自动证据包括：

- collection command 单 outbox、幂等 replay、stale version、替换前快照、owner isolation、单 envelope 和整组 conflict；
- 无效 envelope 的 Dexie 全事务 rollback、cursor 不前进、解决后更晚本机整组替换不被覆盖；
- ACTION_REQUIRED 当前内容重交、新 idempotency identity、过期 Undo 明确放弃和 repair provenance；
- ItemAssociation canonical pair、双向读取、重复阻止、tombstone 与不同步 Item 状态；
- Semester/Course/Item/CourseInformation/RawCapture 的 merge/conflict/version 行为；
- 两个独立 Dexie 数据库经 Fastify + PGlite 完成 A–I 与 K；J 通过受控 pull overlap 测试；
- commit 后丢失响应时使用相同 mutation ID，RawCapture/Item 不重复；
- Web 不显示 mutation、base version 或内部错误，并为字段冲突提供显式值入口、为 collection conflict 只显示组数量。

完整逐场景证据见 `docs/MULTI_DEVICE_VERIFICATION.md`，逐实体能力见 `docs/SYNC_ENTITY_MATRIX.md`。

## 3. 代码存在，但尚无真实环境验收

- 正式 `pg` 连接、迁移器、`002_collection_sync.sql`、开发 seed 和隔离 schema 集成测试已准备；没有 `REAL_DATABASE_URL`，所以真实 PostgreSQL 测试未执行。
- Supabase JWT/JWKS 验证、浏览器 Auth 登录/会话监听、受保护 API 和只读 live smoke script 已准备；没有项目 URL、publishable key、测试账号/access token，所以真实登录链路未执行。
- 双设备测试使用两个独立 Dexie 数据库与正式 worker/HTTP route，但数据库仍是同进程 PGlite，认证仍是固定测试 owner；不是两个物理设备或真实网络生命周期验收。
- OpenAI provider 和结构化输出校验存在；没有真实模型 key/model 验收。
- Reminder claim/deliver/cancel port、本地计划与数据库表存在；没有真实 Windows/Mobile 通知、后台执行、云端 lease API 或时区切换验收。

## 4. 当前真正未实现或未闭合

### Phase 6 / 外部验收

- 在真实 PostgreSQL 运行 migration 与 `real-postgres.integration.test.ts`。
- 在真实 Supabase 完成 login → authenticated API → capture/outbox/push/pull/conflict/resolve/restart/convergence。
- 两个独立浏览器 profile/物理设备上的断网、后台恢复与长时间重试验收。
- 旧开发版本中已经存在逐成员 SemesterWeek/CourseSchedule outbox 的真实 IndexedDB 升级演练。新代码不再生成这些 mutation，服务端暂保留兼容处理，避免静默丢弃。

### 其他阶段 / 发布

- Reminder 云端 device registration、claim/lease、delivery acknowledgement 和平台通知；R-01 生产提醒数值仍是 release gate。
- 真实 AI provider、完整自然语言时间理解、课程表 PDF/图片导入、完整 Search、Phase 7 视觉/响应式/动效收敛、Phase 8 全量 acceptance。

## 5. 已刷新或应废弃的旧审计描述

- “Web 缺少账号入口”已过时：已有 AccountControl 和 Supabase 会话适配器，缺的是外部项目验收。
- “尚无冲突读取/解决 UI”已过时：字段与 collection conflict 均有 UI，且支持显式值；缺的是线上双设备验收。
- “CourseSchedule/SemesterWeek 仍逐实体 outbox”已过时：所有新替换均使用单 collection command。
- “ACTION_REQUIRED 只能重跑整轮同步”已过时：现有逐 mutation 检查、重交/明确放弃和 provenance。
- “ItemAssociation 只有类型和表”已过时：本地 use case、REST、sync create/delete/pull 和测试已闭合。
- “Course/CourseInformation 正式写 API 缺失”已过时：当前接口已补齐。
- 26/35/44/48 等数字是历史阶段快照，不能代表当前覆盖；当前 gate 使用 64 passed + 1 externally gated skip。

`docs/IMPLEMENTATION_AUDIT.md` 已按 Implemented、Verified locally、Verified simulated、Verified real、Not implemented、Blocked、Release blocker 重新整理。

## 6. Phase 6 剩余 blocker

1. **EXTERNAL CONFIGURATION REQUIRED**：真实 PostgreSQL 连接与 Supabase 项目/测试用户/token 缺失，无法产出真实基础设施证据。
2. **ENVIRONMENT VERIFICATION REQUIRED**：尚未在两个独立浏览器 profile 或物理设备执行 A–K 的网络/生命周期验收。
3. **MIGRATION REHEARSAL REQUIRED**：旧逐成员 collection outbox 的真实 IndexedDB 升级样本尚未演练；当前仅保证新写入语义和服务端兼容。

本地协议实现、可修复冲突和模拟双设备闭环已完成，但用户定义的结束条件包含真实环境可用时的验证与所有无法验证项的明确记录。由于外部配置缺失，最终状态保持 **PHASE 6 STATUS: PARTIALLY COMPLETE**，且本轮不进入 Phase 7。
