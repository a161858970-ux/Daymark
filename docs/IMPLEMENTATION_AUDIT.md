# Implementation Audit

**更新日期**：2026-09-24

**审计范围**：Specification 00–21；Phase 1–8；release gates

**当前结论**：**PHASE 6 ENGINEERING IMPLEMENTATION: COMPLETE**；**PHASE 7A–7H: PASS LOCALLY**；**PHASE 8 LOCAL ACCEPTANCE: PASS WITH EXTERNAL RELEASE GATES**。真实基础设施、真实 AI provider、平台通知与物理设备验收没有执行，不计为 PASS。

本审计把“代码存在”“本机执行通过”“模拟基础设施通过”和“真实外部基础设施通过”分开记录。旧审计中的 26/35/44/48 项测试及同步缺口描述是历史快照，已由本文替换。

## 1. Specification gate

- Phase 0 已完整读取 README、00–21 与产品基线，共 24 份 Markdown，并建立 Product/Object/Interaction/State/Data Flow/Architecture/Test Map；结果在根目录 `IMPLEMENTATION_CONTEXT.md`。
- `21_SPEC_AUDIT.md` 的 pre-development gate 为 PASS，未解决 P0 为 0。
- R-01 Numeric Reminder Policy 曾是唯一的产品参数 gate，已于 2026-09-26 按产品指令固化为 v1（`packages/application/src/reminderPolicy.ts`，version `r01-v1`）；`VITE_REMINDER_POLICY` 仅作实验/测试覆盖，引擎默认使用产品 v1。
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
- Course Import 使用 recoverable job、transient source、persisted normalized preview、explicit duplicate decision 和 atomic commit；同 source hash/semester 重复提交返回原结果。
- SAME_COURSE 只从前一学期同名候选继承 CourseInformation；不复制历史 Item 或旧 CourseSchedule。导入 source 中的新 schedule 才属于新 Course instance。

### Verified locally/simulated

- Domain、Dexie 与 PGlite 测试覆盖历史 Overview、周映射、多日期、课程删除策略和 Calendar 排除 CourseSchedule。
- `apps/api/src/db/course-import.test.ts` 覆盖 preview checkpoint、owner isolation、duplicate decision、atomic commit、失败恢复与重复 source 去重。
- `apps/web/src/CourseImportPanel.test.tsx` 和 desktop/390×844 浏览器流程覆盖 review-first UI、入口、local-only gate 与响应式布局。

### Blocked by external configuration

- 没有 OpenAI key/model，真实 PDF/图片识别未运行；手工 Course/CourseSchedule 不依赖该 provider。

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

- 云端 device registration、notification claim/lease、delivery acknowledgement 与浏览器通知适配器已于 2026-09-26 接入（`004_reminder_delivery.sql`、`apps/api/src/db/notifications.ts`、`apps/web/src/reminders.ts`），并有 PGlite 与 Web 自动测试。
- 真实设备上的系统通知、后台执行与长周期 lease 生命周期仍未实机验收。
- R-01 已固化为产品 v1 policy（含 same-day cadence、per-level daily budget、occurrence-after 初次偏移、quiet hours 23:00–08:00、dedup 60min、“提醒我”默认 HIGH），本地 acceptance 全部继续通过。

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

## 8. Phase 7A–7H — Visual / Responsive / Motion

### 8.1 Implemented

- 7A 建立完整视觉 token、Windows 左侧导航、Mobile 底部导航、响应式 shell、首载和离线状态。
- 7B 收敛 Overview、Course index/detail、Item rows、completed section、CourseInformation 与页面层级；保留课程导向和两个独立 Item hit target。
- 7C 将 Quick Capture 变为全局单一 morphing control；支持 autofocus、连续记录、成功/失败状态、外部点击和 Escape 焦点返回。
- 7D 完成单一 Windows detail container、Mobile Bottom Sheet、同容器 edit、语义化 facts、删除二次确认、完成/恢复/删除/Undo motion 与键盘焦点管理。
- 7E 完成 Calendar month/week/day：传统七列结构、单一范围导航、today/selected/overflow 状态、连续多日 range、按时间排序的 Single Day 和移动端日期钻取流程。
- 7F 完成全局 Search、unresolved/Conflict/ACTION_REQUIRED attention surfaces、账户与同步状态，以及这些 surface 的 desktop/mobile 空间与键盘行为。
- 7G 完成统一 motion timing、reduced-motion aware exit presence、页面与课程内容过渡、Quick Capture 成功浮层、transient notice 离场、desktop/mobile detail exit 和 Calendar 改期到达提示。
- 7H 完成 `360–1440px` breakpoint matrix、Mobile 44px 操作目标、Bottom Sheet modal/Tab loop、分层 Escape、页面滚动复位、窄桌面浮动控件安全区与跨断点 Item identity continuity。
- Search 使用确定性本地关键词匹配和轻量对象分组；Windows 固定入口与 header shortcut、Mobile header 入口共享一个 surface，结果直接打开 canonical Item/Course/CourseInformation。
- attention surfaces 默认只占一行摘要；展开后沿用既有解析决定、字段/整组冲突与 repair 权限，不暴露 mutation、版本、SQL 或队列内部状态。
- Calendar 继续只投影 Item；多日与完成状态都保留同一 Item identity，CourseSchedule 没有进入 Calendar。
- Detail 查看、编辑和 surface orchestration 分为 `ItemDetailView`、`ItemEditForm` 与 `ItemDetail`；React 组件不承载 persistence、AI 或 sync protocol。
- selection request/ref guard 阻止快速切换事项时，较早的 RawCapture/association/refresh 结果覆盖当前详情对象。
- Search/Account/Detail 的关闭会先播放短离场再卸载；reduced-motion 下不等待视觉动画。删除失败保持详情，不把失败操作表现成成功关闭。

### 8.2 Verified locally

- Desktop browser：Overview、Course index/detail、global Quick Capture、单一详情容器与对象切换均通过人工验证。
- Mobile browser：390×844 下底部导航、Quick Capture 与 Bottom Sheet 通过人工验证；Sheet 计算样式为 bottom anchored、rounded top、drag handle visible。
- Keyboard/focus：Quick Capture Escape、detail close、edit Escape、delete-confirm Escape、编辑 autofocus 和关闭后返回当前 Item 行通过人工验证。
- State motion：完成即时状态、约 180ms hold + leave、completed count、完成 Undo、恢复 re-entry 均通过真实浏览器流程；删除人工验收到二次确认，正式 delete/Undo identity 由 application/storage 自动测试覆盖。
- Calendar desktop：月/周导航、跨周 range、日期与 Item 双命中层级、Single Day 与原生 Item Detail 已人工验证。
- Calendar mobile：390×844 下月视图不显示狭小 event target；日期 → Single Day → Bottom Sheet、分层 Escape 与日期焦点返回已人工验证。
- Search desktop/mobile：输入 autofocus、三类结果、Item 原生详情、CourseInformation 原位置、Escape 与 trigger focus return 已人工验证。
- Attention/account desktop/mobile：待确认摘要、仅本机状态、账户 popover 边界与键盘关闭已人工验证；Conflict/ACTION_REQUIRED 的选择边界继续由静态 surface 与 sync 集成测试覆盖。
- Motion desktop/mobile：捕获 page/content/completed transition、Quick Capture 成功浮层、Windows `detail-out`、Mobile `sheet-out`、关闭后焦点返回与 reduced-motion stylesheet gate；Search/Account 退出后均返回原 trigger。
- Calendar 改期：手工将测试事项从 9 月 30 日移动到 9 月 29 日，捕获同一 id 的 `calendar-item-relocated` 360ms，再恢复原日期；整张月历未重挂。
- Responsive/accessibility：`360×800`、`390×844`、`430×932`、`768×900`、`1023×900`、`1024×900`、`1100×900`、`1101×900`、`1366×768`、`1440×900` 无水平溢出；Mobile 可见操作目标无小于约 44px 的命中区。
- Keyboard/screen reader：导航焦点可见；Enter 激活；Search/Account/Quick Capture/Detail 分层 Escape；Mobile Detail `aria-modal` + Tab loop；desktop Detail 保持非 modal；关闭后焦点返回。
- Resize：同一 Item 在 desktop → mobile → compact desktop → desktop 间保持 identity，详情只切换 Side Container / Bottom Sheet 表达。
- Phase 7 closure 时 `pnpm build`、`pnpm test`、`pnpm lint`、`pnpm format:check` 全部通过，快照为 **88 passed，1 externally gated skip**，其中 Web 为 **23 passed**；Phase 8 最新总数见下节。
- `pnpm --filter @course-manager/web dev` 已启动并由 HTTP 200 验证。Phase 7 closure 时 Vite 主 bundle 约 544 kB；Course Import 加入后的当前数字见 Phase 8 gate。

### 8.3 Phase 7 result

> **PHASE 7 VISUAL / RESPONSIVE / MOTION: COMPLETE LOCALLY**

完整断点与可访问性证据见 `RESPONSIVE_ACCEPTANCE_MATRIX.md`。物理手机、Windows 触屏设备、屏幕阅读器和移动软键盘仍需 Phase 8 / release validation 实机验收。

## 9. Phase 8 — Test / Hardening / Acceptance

### 9.1 Implemented and verified locally

- 建立 `docs/ACCEPTANCE_TRACEABILITY.md`，逐项映射 `T-ITEM-001..007`、`T-OV-001..007`、`T-COURSE-001..006`、`T-ASSOC-001`、`T-CAL-001..011`、`T-QC-001..006`、`T-AI-001..010`、`T-RM-001..010`、`T-SYNC-001..008`、`T-REC-001..005`，以及 cross-view、cross-platform、UX/Motion 和 accessibility 条目。
- 增加一条 integrated local-first acceptance：同一 Item 贯穿 capture、Overview、Course、Calendar、Reminder、edit、complete/restore、delete/Undo 和 RawCaptureOutput，验证 identity、created_at、tombstone 与 provenance。
- 增加 exact sync acceptance：并发 complete 无冲突、不同 due date 显式冲突、非重叠字段安全合并、tombstone 传播。
- 增加 deferred ambiguity 重启验收：defer 后关闭/重开 IndexedDB 仍显示 unresolved，明确删除后不再提示且不创建 Item。
- 补齐 Calendar month overlap/week-boundary、Overview completed separation/default collapse 的直接 acceptance 证据。
- Course Import 补齐正式 contracts、migration `003_course_import.sql`、recoverable service/API、OpenAI file/image adapter、review UI、failure recovery、source hash idempotency 与自动测试。

### 9.2 Final local gate

- `pnpm test`：**136 passed，1 skipped**（2026-09-26 Release Candidate Hardening gate）。
  - domain：11 passed；application：17 passed；storage：32 passed；API：41 passed + 1 real PostgreSQL skipped；Web：35 passed。
- `pnpm build`：PASS；entry chunk 由 555.89 kB 降为 348.28 kB（react-vendor 独立分包 218.83 kB），>500 kB warning 消失。
- `pnpm lint`、`pnpm format:check`、`git diff --check`：PASS。
- 运行态检查：Web `http://127.0.0.1:5173/` HTTP 200；API `/api/v1/health` HTTP 200 / `status=ok`。
- 运行中的 Vite 页面完成 Course Import desktop/mobile entry、review surface、无水平溢出与触控目标检查；Phase 7 的完整 viewport/motion evidence 继续有效。

### 9.3 Result

> **PHASE 8 LOCAL ACCEPTANCE: PASS WITH EXTERNAL RELEASE GATES**

本地自动、浏览器和模拟基础设施的规格证据已经闭合，R-01 已解决，真实 MiMo provider 已通过 `pnpm verify:ai --with-import` smoke。真实 PostgreSQL/Supabase、物理设备通知与 accessibility/device matrix 仍保持独立 gate，因此当前状态不是 production release PASS。

## 10. Current test evidence

- `packages/domain/src/*.test.ts`：领域投影、排序、学期规则。
- `packages/application/src/reminders.test.ts`：提醒策略与 stale guard。
- `packages/storage/src/storage.test.ts`：本地产品流程、collection 单 outbox、ItemAssociation。
- `packages/storage/src/acceptance.test.ts`：T-ITEM 主链路、跨视图/提醒一致性、unresolved 重启与明确删除。
- `packages/storage/src/migration.test.ts`：Dexie v5 → v6 迁移、collection command 折叠、provenance 与不可还原旧删除隔离。
- `packages/storage/src/sync.test.ts`：cursor、overlap、repair、collection envelope、resolution + later edit。
- `apps/api/src/db/collection-sync.test.ts`：collection/association/academic concurrency。
- `apps/api/src/db/multi-device.test.ts`：A–I/K 与 `T-SYNC-005..008` exact acceptance。
- `apps/api/src/db/course-import.test.ts`：Course Import preview/recovery/duplicate decision/atomic commit/idempotency。
- `apps/api/src/db/notifications.test.ts`：device registration、跨设备 claim/lease、delivery ack、完成后的 stale 取消与 owner 隔离。
- `apps/api/src/ai/*.test.ts`：MiMo Chat Completions 结构化输出与 PDF 页文字提取。
- `apps/web/src/reminders.test.ts`：策略注入、lease/离线交付、ack、取消、通知点击打开当前 Item、权限缺失回退与调度器完成停止。
- `apps/api/src/db/resource-coverage.test.ts`：正式 REST 资源覆盖。
- `apps/api/src/db/real-postgres.integration.test.ts`：真实 PostgreSQL gate；当前 skipped。
- `apps/web/src/*.test.tsx` 与 `motion.test.ts`：导航、Course/Item 层级、Quick Capture 单控件 identity、Detail surface/mobile modal、删除/恢复 motion class、Calendar range/day/position semantics、Search 分组、attention/account 状态、transient notice、reduced-motion timing、Conflict 与 SyncRepair 安全展示。

## 11. Known limitations and release blockers

1. **External sync validation**：真实 PostgreSQL/Supabase/双浏览器尚未执行。
2. **Reminder release**：R-01 已定为 v1；云端 lease/ack 与浏览器通知适配器已完成，真实设备通知、后台执行未实机验收。
3. **AI release**：真实 interpretation 与 PDF（含扫描版）/image import provider 已通过 `pnpm verify:ai --with-import` smoke；完整自然语言时间语义仍走保守确认。
4. **Physical validation**：物理设备、两个真实 browser profile、屏幕阅读器、系统缩放和移动软键盘未实机验证。
5. **Bundle**：已通过 vendor 分包把 entry 降到 348.28 kB 并消除 size warning；更深度的按路由懒加载与依赖裁剪记为 POST-RELEASE PERFORMANCE OPTIMIZATION。

## 12. Spec deviations

- 没有发现新的产品语义偏差。
- 平台技术选择差异沿用 ADR-001，来自交接允许的 React/Vite、Dexie、Fastify/PostgreSQL 方向。
- AI provider 由 OpenAI Responses 改为用户指定的 MiMo Chat Completions（`AI_BASE_URL`/`AI_MODEL` 可配置），属于 provider 实现替换：确定性优先、严格 schema、失败不建正式对象等产品语义不变；PDF 源改为服务端按页处理：有文本层走页文字，无可信文本层栅格化为受控图片后走既有图片输入（ADR-006），因为该端点不接受 file 输入。
- R-01 按产品指令固化为 v1，数值集中在一个数据对象里，未散落在引擎代码中；测试夹具数值仍标注为 fixture。

## 13. Next gate

R-01 与真实 AI provider smoke 已完成。剩余 release lanes：拿到外部配置后按 `REAL_POSTGRES_VERIFICATION.md` 完成真实 PostgreSQL、Supabase、双浏览器验收；再在物理 Mobile/Windows、屏幕阅读器、系统缩放和软键盘环境执行剩余矩阵（含系统通知与后台执行）。每条外部证据完成后单独更新本审计，不用模拟结果替代。

## 14. Release Candidate Hardening（2026-09-26）

范围冻结：不新增规格外功能、不重开 Phase 7、不重构 `App.tsx`。

### IMPLEMENTED

- 扫描版 PDF 按页 fallback：无可信文本层的页栅格化为受控 JPEG（≤1600px/q72，总图 ≤6MB、≤8 页、单请求 ≤4 图），分批结果按课程名合并；超限用中文产品文案，job 保持可恢复（ADR-006）。
- Provider 错误分类 + 仅瞬时错误重试一次 + 导入 300s / 解释 90s 超时；无密钥时 `pnpm verify:ai` 输出 `REAL_AI_REQUIRED`（退出码 2）。
- 工程错误到产品文案的两层映射：服务端 `importFailureMessage()`、Web `toUserMessage()`。
- R-01 固化为产品 v1 policy，引擎补齐 same-day cadence、per-level daily budget、occurrence-after 初次偏移；“提醒我”默认 HIGH。
- Vite vendor 分包（仅配置，行为不变）。

### VERIFIED LOCALLY

- `pnpm test` 134 passed + 1 skipped；`pnpm build` / `pnpm lint` / `pnpm format:check` / `git diff --check` 全部 PASS。
- 新增测试：扫描 PDF fallback、栅格/页数/payload 限制、不可读文件、15MB 超限、provider 401/500/超时/非 JSON、重试次数、batch 合并、R-01 十项行为、产品错误文案。

### VERIFIED REAL

- `pnpm verify:ai --with-import`：`PASS interpretation 28240ms`、`PASS import 37633ms courses=3`（真实 MiMo mimo-v2.6-flash，strict json_schema，2 页扫描 fixture 走栅格化路径）。

### BLOCKED BY EXTERNAL CONFIGURATION

- `REAL_DATABASE_URL`、Supabase 项目/测试账号/token、两个独立 browser profile。

### NOT RUN PHYSICAL

- 物理手机/Windows 设备的系统通知与后台执行、屏幕阅读器、系统缩放、移动软键盘。

### RELEASE BLOCKER

- 无新增 P0；上述外部配置与实机矩阵仍需完成后才可宣称 production release。

> **RC HARDENING: COMPLETE**
