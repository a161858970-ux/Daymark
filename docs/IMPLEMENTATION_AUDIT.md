# Implementation Audit

**更新日期**：2026-09-24

**审计范围**：Specification 00–21；当前代码至 Phase 6

**当前结论**：**PHASE 6 STATUS: PARTIALLY COMPLETE**

本审计把“代码存在”“本机执行通过”“模拟基础设施通过”和“真实外部基础设施通过”分开记录。旧审计中的 26/35/44/48 项测试及同步缺口描述是历史快照，已由本文替换。

## 1. Specification gate

- Phase 0 已完整读取 README、00–21 与产品基线，共 24 份 Markdown，并建立 Product/Object/Interaction/State/Data Flow/Architecture/Test Map；结果在根目录 `IMPLEMENTATION_CONTEXT.md`。
- `21_SPEC_AUDIT.md` 的 pre-development gate 为 PASS，未解决 P0 为 0。
- 唯一明确的产品参数 gate 仍是 R-01 Numeric Reminder Policy。Reminder Engine 只接受注入配置和测试 fixture，没有擅自写入生产数值。
- 本轮没有改变 Capture First、RawCapture provenance、Course-oriented、Calendar 只投影 Item、二态 Item、删除 Undo、AI 不把猜测当事实等产品不变量。

## 2. Phase 1 — Project Foundation

### Implemented

- pnpm TypeScript workspace；React/Vite Web；Fastify API；共享 Zod contracts；Dexie IndexedDB；PostgreSQL migration；Vitest、ESLint、Prettier 与环境变量样例。
- UI → application → domain → infrastructure 边界存在；React 不进入 domain，UI 不直接访问 PostgreSQL 或 AI provider。
- migration runner 按文件名和 `schema_migrations` 幂等执行 SQL。

### Verified locally

- `pnpm build`、`pnpm test`、`pnpm lint`、`pnpm format:check` 通过。
- `pnpm dev` 可同时启动 Web 与 API；Web HTTP 200；`/api/v1/health` 返回 `ok`。

### Architecture note

根据交接要求，当前 Web 使用 React/Vite + Dexie，API 使用 Fastify + PostgreSQL。与早期规格中的平台技术建议差异记录在 `ADR-001-platform-and-local-storage.md`；领域和交互语义未改。

## 3. Phase 2 — First Vertical Slice

### Implemented

- Quick Capture → 本地 RawCapture/outbox → 确定性 normalization → Item/CourseInformation 或 unresolved → Overview/Course。
- 原文和 UI Course context 保留；一条 RawCapture 可通过 RawCaptureOutput 关联多个正式对象。
- Item 编辑、完成/恢复、删除确认、限时 Undo；CourseInformation 独立 CRUD；详情保留 provenance。
- 认证 REST、owner scope、If-Match、Idempotency-Key 和本地 sync worker 基础闭环。

### Verified with simulated infrastructure

- 原文重启留存、同一 Item 跨视图、完成/删除/Undo、人工决定、多输出、owner-scoped 课程匹配与基础 sync roundtrip 均有自动测试。

### Remaining outside this phase

- 完整自然语言时间解析与完整 Search 尚未实现；这些没有被当前同步工作掩盖或伪装成完成。

## 4. Phase 3 — Course / Semester / Calendar

### Implemented

- Semester、历史/当前学期、Course、CourseInformation、CourseSchedule、SemesterWeek、跨学期同名候选确认与受限继承。
- Overview 默认规则、Calendar 月/周/日投影、多日 Item、历史学期过滤。
- CourseSchedule 与 Item 分离；Calendar 不显示课表。
- Course 删除要求“删除关联事项”或“解除课程关联”，在本地和服务端都原子执行。

### Verified locally/simulated

- Domain、Dexie 与 PGlite 测试覆盖历史 Overview、周映射、多日期、课程删除策略和 Calendar 排除 CourseSchedule。

### Not implemented

- PDF/图片课表导入及人工核对；当前只支持手工 CourseSchedule。

## 5. Phase 4 — AI Pipeline

### Implemented

- UI context → deterministic rules → normalized parsing → 需要时的模型候选；RawCapture 先保存。
- classification/extraction/ambiguity/MULTI_ITEM_CANDIDATE；拆分或保持一条由用户决定并保留 RawCaptureDecision/Output provenance。
- 服务端 provider 输出由共享 Zod schema 验证；无事实来源的课程/时间候选被拒绝；模型失败不创建正式事实。

### Verified with simulated provider

- 确定性短路、候选校验、拆分/拒绝、多次处理不重复、超时和原文留存通过自动测试。

### Blocked by external configuration

- 无 OpenAI API key/model，真实模型调用未验收。

## 6. Phase 5 — Reminder Engine

### Implemented

- ReminderPolicy 注入；due/occurrence/start 语义；quiet hours、daily cap、stable logical key、stale guard、重排、取消和本地 Dexie 恢复。
- claim/deliver/cancel 以 port 隔离具体平台，Reminder 不创建用户未提供的学习计划。

### Verified locally

- 单元/存储测试覆盖无时间、完成/删除、时间变化、等级变化、逾期继续、occurrence 结束、quiet hours、上限、去重与重启。

### Not implemented / release blocker

- 云端 device registration、notification claim/lease、delivery acknowledgement、Windows/Mobile 通知和后台执行未接入。
- R-01 生产数值未决；生产提醒不能 release-complete。

## 7. Phase 6 — Offline / Sync / Conflict

### 7.1 Implemented

#### Core protocol

- 本地 transaction + ordered outbox；首次 owner binding；客户端 canonical UUID；push idempotency；pull opaque cursor；change log；soft-delete tombstone；版本/字段历史；成功 ACK 与本地 server version 原子更新。
- pull 页若与新本机 mutation 重叠，整页和 cursor 保持不变；网络/5xx 重试保留相同 mutation ID；永久拒绝进入 ACTION_REQUIRED。

#### Field conflicts

- Semester、Course、Item、CourseInformation、RawCapture 支持非重叠字段合并和同字段 SyncConflict。
- 冲突 list/detail/resolve API owner-scoped，resolution 要求已查看 revision、完整字段选择和独立 idempotency key。
- UI 只显示对象、真正冲突字段、本机值、当前已同步值与显式值输入。SQL、row version、outbox/mutation 细节不显示。
- 已删除对象禁止选择本机/显式值恢复；delete-vs-edit 必须保留删除或走正式 Undo 语义。
- 接受旧 resolution 时会 ACK 对应 rejected mutation，但保留更晚的本机 mutation，并把其 base 更新到解决后的 server version。

#### Collection replacement

- SemesterWeek 与 CourseSchedule 的每次整组替换只写一个父对象级 outbox command：稳定 command ID、base collection version、previous collection、desired collection。
- migration `002_collection_sync.sql` 增加 owner-scoped collection revision/hash。
- 服务端锁定 parent/revision，在一个 PostgreSQL transaction 内验证成员、比较 version 与旧快照、应用整组、保留 client IDs、写一个 envelope 与幂等结果。
- stale 并发形成 `collection` 冲突；用户只能选择完整本机组或完整已同步组。pull 在一个 Dexie transaction 内应用完整 envelope 和 cursor。
- 普通 REST 的 weeks/schedules replace 进入同一个 collection revision/change stream，不会绕过离线并发检测。
- 详细决定见 `ADR-005-collection-replacement-sync.md`。

#### ACTION_REQUIRED repair

- 用户可查看受影响对象和可读原因；允许时按当前本地字段、新 mutation ID、已知 server version 重交。
- 用户可经二次确认明确采用已同步状态；动作会 ACK 原 mutation、重置 cursor，并让下一次 pull 恢复 canonical state。
- 过期 Undo 不可重试为 undelete；collection abandon 恢复 previous collection；RawCapture 不被静默删除。
- 每次动作写 SyncRepairDecision，记录旧/新 mutation、被替代 mutation、原错误、设备和时间。

#### Entity coverage

- Course PATCH、CourseInformation POST/PATCH/DELETE、unresolved RawCapture DELETE 已补齐。
- ItemAssociation 已实现本地 create/list/delete、canonical pair、REST、sync create/delete/pull、row version/tombstone；关联不传播完成状态。
- 完整能力表见 `SYNC_ENTITY_MATRIX.md`。

#### Real integration preparation

- `.env.example` 列出 PostgreSQL、Supabase、seed 和 live verification 参数。
- `pnpm db:migrate`、`pnpm db:seed`、`pnpm test:postgres`、`pnpm verify:live-api` 已提供。
- real PostgreSQL 测试创建随机 schema、应用正式 migration、运行 collection sync、核对 envelope 并清理 schema。
- 具体步骤和安全边界见 `REAL_POSTGRES_VERIFICATION.md`。

### 7.2 Verified locally

- `pnpm build`：PASS。Vite 仅报告单 bundle 大于 500 kB 的非阻塞 warning。
- `pnpm test`：**64 passed，1 skipped**。
  - domain 7；application 4；storage 28；API 21 passed + 1 real PostgreSQL skipped；Web 4。
- `pnpm lint`：PASS。
- `pnpm format:check`：PASS。
- `pnpm dev`：Web HTTP 200；API health HTTP 200 / `status=ok`。

### 7.3 Verified with simulated infrastructure

- PGlite + Fastify + fake IndexedDB 跑正式 migration、REST/sync route 和 application worker。
- A–I/K 使用两个独立 Dexie 设备或受控 lossy transport；J 使用 pull transaction overlap 注入。A–K 的 Initial/Operations/Expected/Actual/PASS 见 `MULTI_DEVICE_VERIFICATION.md`。
- collection tests覆盖 replay、owner scope、stale version、LOCAL/REMOTE resolution、canonical ID、单 envelope 和 ItemAssociation。
- ACTION_REQUIRED tests覆盖当前内容重交、new idempotency identity、过期 Undo 安全放弃和 provenance。

### 7.4 Verified in real infrastructure

**None.** 当前没有真实 PostgreSQL/Supabase 凭据；没有把 skipped test 或 PGlite 结果写成真实验证。

### 7.5 Not implemented / not closed

- 真实 Supabase login 和 authenticated browser sync。
- 外部 PostgreSQL migration/integration run。
- 两个浏览器 profile/物理设备的断网、后台、重启和长时间 retry 生命周期。
- 旧开发 IndexedDB 中逐成员 SemesterWeek/CourseSchedule pending outbox 的真实升级演练。服务端暂保留旧命令兼容；新代码不会再生成。
- Reminder 云端 delivery/lease 属于 Phase 5/发布缺口，不由通用 entity sync 代替。

### 7.6 Blocked by external configuration

- 当前机器没有 `docker`、`psql`、`DATABASE_URL`、`REAL_DATABASE_URL`、Supabase 项目 URL、测试账号或 access token。
- 需要可丢弃 PostgreSQL database、Supabase project/test user 和两个独立浏览器 profile 才能继续真实验收。

### 7.7 Phase 6 result

本地同步协议、collection replace、ACTION_REQUIRED、entity coverage、可重复 A–K 与真实环境入口已经闭合。真实外部基础设施和设备生命周期没有证据，且旧 IndexedDB 升级演练未完成。因此遵守用户结束条件，不宣称 COMPLETE：

> **PHASE 6 STATUS: PARTIALLY COMPLETE**

## 8. Current test evidence

- `packages/domain/src/*.test.ts`：领域投影、排序、学期规则。
- `packages/application/src/reminders.test.ts`：提醒策略与 stale guard。
- `packages/storage/src/storage.test.ts`：本地产品流程、collection 单 outbox、ItemAssociation。
- `packages/storage/src/sync.test.ts`：cursor、overlap、repair、collection envelope、resolution + later edit。
- `apps/api/src/db/collection-sync.test.ts`：collection/association/academic concurrency。
- `apps/api/src/db/multi-device.test.ts`：A–I/K。
- `apps/api/src/db/resource-coverage.test.ts`：正式 REST 资源覆盖。
- `apps/api/src/db/real-postgres.integration.test.ts`：真实 PostgreSQL gate；当前 skipped。
- `apps/web/src/ConflictPanel.test.tsx`、`SyncRepairPanel.test.tsx`：不泄露内部数据与安全用户操作。

## 9. Known limitations and release blockers

1. **External sync validation**：真实 PostgreSQL/Supabase/双浏览器尚未执行。
2. **Legacy local upgrade rehearsal**：旧 collection row mutation 的真实 IndexedDB 样本未演练。
3. **Reminder release**：R-01、云端 lease、平台通知和后台能力未完成。
4. **AI release**：真实 provider 未验收，完整时间语义仍走保守确认。
5. **Feature scope**：课程表导入、完整 Search、Phase 7、Phase 8 未实施。
6. **Bundle**：Web 主 bundle 约 509 kB，构建通过但有 Vite size warning；可在后续非 Phase 6 阶段做按路由/功能拆分。

## 10. Spec deviations

- 没有发现新的产品语义偏差。
- 平台技术选择差异沿用 ADR-001，来自交接允许的 React/Vite、Dexie、Fastify/PostgreSQL 方向。
- R-01 保持未决；没有以开发默认值冒充生产政策。

## 11. Next gate

下一步应先按 `REAL_POSTGRES_VERIFICATION.md` 获取外部配置并完成真实 Phase 6 验收，修复任何由真实网络/JWT/数据库暴露的问题；随后更新本文的 real infrastructure 与旧数据升级证据。通过该 gate 后才进入 Phase 7。
