# Implementation Audit

**更新日期**：2026-09-24

**审计范围**：Specification 00–21；Phase 6 implementation closure；Phase 7A–7F

**当前结论**：**PHASE 6 ENGINEERING IMPLEMENTATION: COMPLETE**；**PHASE 7A–7F: PASS LOCALLY**；真实基础设施验收仍为 **BLOCKED BY EXTERNAL CONFIGURATION**，不计为 PASS

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

- 完整自然语言时间解析尚未实现；全局本地关键词 Search 已在 Phase 7F 完成，且不依赖 AI 排名。

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
- Dexie v6 会把可识别父级的旧版逐成员 pending outbox 原子折叠为一条 collection command；旧 mutation 保留，并以 `SUPERSEDED_BY_COLLECTION` 明确记录由哪个新 command 取代。
- 迁移通过当前本地集合反推 desired collection，并从 tombstone/outbox history 反推 previous collection。若旧 SemesterWeek 删除已经丢失完整快照，迁移使用保守空基线，使远端非空时形成显式 collection conflict；若连 parent 都无法证明，则保留旧 mutation、标记 ACTION_REQUIRED，并阻止 worker 逐成员上传。
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
- `pnpm test`：**66 passed，1 skipped**。
  - domain 7；application 4；storage 30；API 21 passed + 1 real PostgreSQL skipped；Web 4。
- `pnpm lint`：PASS。
- `pnpm format:check`：PASS。
- `pnpm dev`：Web HTTP 200；API health HTTP 200 / `status=ok`。

### 7.3 Verified with simulated infrastructure

- PGlite + Fastify + fake IndexedDB 跑正式 migration、REST/sync route 和 application worker。
- A–I/K 使用两个独立 Dexie 设备或受控 lossy transport；J 使用 pull transaction overlap 注入。A–K 的 Initial/Operations/Expected/Actual/PASS 见 `MULTI_DEVICE_VERIFICATION.md`。
- collection tests覆盖 replay、owner scope、stale version、LOCAL/REMOTE resolution、canonical ID、单 envelope 和 ItemAssociation。
- ACTION_REQUIRED tests覆盖当前内容重交、new idempotency identity、过期 Undo 安全放弃和 provenance。
- fake IndexedDB 从真实 v5 schema 打开到 v6：核对 SemesterWeek/CourseSchedule 数据不丢失、旧 row mutation 被单 collection command 取代、未来 worker 只上传整组；另有不可还原删除的隔离测试，证明不会产生半组上传或静默丢弃。

### 7.4 Verified in real infrastructure

**None.** 当前没有真实 PostgreSQL/Supabase 凭据；没有把 skipped test 或 PGlite 结果写成真实验证。

### 7.5 Not implemented / not closed

- 真实 Supabase login 和 authenticated browser sync。
- 外部 PostgreSQL migration/integration run。
- 两个浏览器 profile/物理设备的断网、后台、重启和长时间 retry 生命周期。
- Reminder 云端 delivery/lease 属于 Phase 5/发布缺口，不由通用 entity sync 代替。

### 7.6 Blocked by external configuration

- 当前机器没有 `docker`、`psql`、`DATABASE_URL`、`REAL_DATABASE_URL`、Supabase 项目 URL、测试账号或 access token。
- 需要可丢弃 PostgreSQL database、Supabase project/test user 和两个独立浏览器 profile 才能继续真实验收。

### 7.7 Phase 6 result

本地同步协议、collection replace、旧 IndexedDB migration rehearsal、ACTION_REQUIRED、entity coverage、可重复 A–K 与真实环境入口已经闭合。因此 Phase 6 的工程实现可以封存：

> **PHASE 6 ENGINEERING IMPLEMENTATION: COMPLETE**

真实 PostgreSQL、Supabase authentication 与两个独立浏览器/物理设备的生命周期仍没有执行证据，状态保持：

> **RELEASE INFRASTRUCTURE VERIFICATION: BLOCKED BY EXTERNAL CONFIGURATION**

## 8. Phase 7A–7F — Visual / Responsive / Motion

### 8.1 Implemented

- 7A 建立完整视觉 token、Windows 左侧导航、Mobile 底部导航、响应式 shell、首载和离线状态。
- 7B 收敛 Overview、Course index/detail、Item rows、completed section、CourseInformation 与页面层级；保留课程导向和两个独立 Item hit target。
- 7C 将 Quick Capture 变为全局单一 morphing control；支持 autofocus、连续记录、成功/失败状态、外部点击和 Escape 焦点返回。
- 7D 完成单一 Windows detail container、Mobile Bottom Sheet、同容器 edit、语义化 facts、删除二次确认、完成/恢复/删除/Undo motion 与键盘焦点管理。
- 7E 完成 Calendar month/week/day：传统七列结构、单一范围导航、today/selected/overflow 状态、连续多日 range、按时间排序的 Single Day 和移动端日期钻取流程。
- 7F 完成全局 Search、unresolved/Conflict/ACTION_REQUIRED attention surfaces、账户与同步状态，以及这些 surface 的 desktop/mobile 空间与键盘行为。
- Search 使用确定性本地关键词匹配和轻量对象分组；Windows 固定入口与 header shortcut、Mobile header 入口共享一个 surface，结果直接打开 canonical Item/Course/CourseInformation。
- attention surfaces 默认只占一行摘要；展开后沿用既有解析决定、字段/整组冲突与 repair 权限，不暴露 mutation、版本、SQL 或队列内部状态。
- Calendar 继续只投影 Item；多日与完成状态都保留同一 Item identity，CourseSchedule 没有进入 Calendar。
- Detail 查看、编辑和 surface orchestration 分为 `ItemDetailView`、`ItemEditForm` 与 `ItemDetail`；React 组件不承载 persistence、AI 或 sync protocol。
- selection request/ref guard 阻止快速切换事项时，较早的 RawCapture/association/refresh 结果覆盖当前详情对象。

### 8.2 Verified locally

- Desktop browser：Overview、Course index/detail、global Quick Capture、单一详情容器与对象切换均通过人工验证。
- Mobile browser：390×844 下底部导航、Quick Capture 与 Bottom Sheet 通过人工验证；Sheet 计算样式为 bottom anchored、rounded top、drag handle visible。
- Keyboard/focus：Quick Capture Escape、detail close、edit Escape、delete-confirm Escape、编辑 autofocus 和关闭后返回当前 Item 行通过人工验证。
- State motion：完成即时状态、约 180ms hold + leave、completed count、完成 Undo、恢复 re-entry 均通过真实浏览器流程；删除人工验收到二次确认，正式 delete/Undo identity 由 application/storage 自动测试覆盖。
- Calendar desktop：月/周导航、跨周 range、日期与 Item 双命中层级、Single Day 与原生 Item Detail 已人工验证。
- Calendar mobile：390×844 下月视图不显示狭小 event target；日期 → Single Day → Bottom Sheet、分层 Escape 与日期焦点返回已人工验证。
- Search desktop/mobile：输入 autofocus、三类结果、Item 原生详情、CourseInformation 原位置、Escape 与 trigger focus return 已人工验证。
- Attention/account desktop/mobile：待确认摘要、仅本机状态、账户 popover 边界与键盘关闭已人工验证；Conflict/ACTION_REQUIRED 的选择边界继续由静态 surface 与 sync 集成测试覆盖。
- `pnpm build`、`pnpm test`、`pnpm lint`、`pnpm format:check` 全部通过；当前全仓为 **82 passed，1 externally gated skip**，其中 Web 为 **17 passed**。
- Vite 仍仅报告单 bundle 大于 500 kB 的非阻塞 warning，当前主 bundle 约 541 kB。

### 8.3 Remaining in Phase 7

- 7G 全局 motion consistency、Calendar completion 和跨 surface polish。
- 7H 完整 desktop/mobile breakpoint、键盘、reduced-motion 和最终视觉 acceptance matrix。

当前 surface 缺口与每阶段 gate 见根目录 `UI_SURFACE_AUDIT.md`。

## 9. Current test evidence

- `packages/domain/src/*.test.ts`：领域投影、排序、学期规则。
- `packages/application/src/reminders.test.ts`：提醒策略与 stale guard。
- `packages/storage/src/storage.test.ts`：本地产品流程、collection 单 outbox、ItemAssociation。
- `packages/storage/src/migration.test.ts`：Dexie v5 → v6 迁移、collection command 折叠、provenance 与不可还原旧删除隔离。
- `packages/storage/src/sync.test.ts`：cursor、overlap、repair、collection envelope、resolution + later edit。
- `apps/api/src/db/collection-sync.test.ts`：collection/association/academic concurrency。
- `apps/api/src/db/multi-device.test.ts`：A–I/K。
- `apps/api/src/db/resource-coverage.test.ts`：正式 REST 资源覆盖。
- `apps/api/src/db/real-postgres.integration.test.ts`：真实 PostgreSQL gate；当前 skipped。
- `apps/web/src/*.test.tsx`：导航、Course/Item 层级、Quick Capture 单控件 identity、Detail surface、删除/恢复 motion class、Calendar range/day semantics、Search 分组、attention/account 状态、Conflict 与 SyncRepair 安全展示。

## 10. Known limitations and release blockers

1. **External sync validation**：真实 PostgreSQL/Supabase/双浏览器尚未执行。
2. **Reminder release**：R-01、云端 lease、平台通知和后台能力未完成。
3. **AI release**：真实 provider 未验收，完整时间语义仍走保守确认。
4. **Feature scope**：课程表导入、Phase 7G–7H、Phase 8 未实施。
5. **Bundle**：Web 主 bundle 约 541 kB，构建通过但有 Vite size warning；可在后续阶段做按路由/功能拆分。

## 11. Spec deviations

- 没有发现新的产品语义偏差。
- 平台技术选择差异沿用 ADR-001，来自交接允许的 React/Vite、Dexie、Fastify/PostgreSQL 方向。
- R-01 保持未决；没有以开发默认值冒充生产政策。

## 12. Next gate

产品开发路线下一步进入 Phase 7G，并以 `UI_SURFACE_AUDIT.md` 为界继续全局 motion consistency、跨 surface polish 与最终 responsive/accessibility acceptance。发布基础设施路线独立保留：拿到外部配置后按 `REAL_POSTGRES_VERIFICATION.md` 完成真实 PostgreSQL、Supabase 与双浏览器验收，再更新本文的 real infrastructure 证据。
