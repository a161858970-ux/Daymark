# Acceptance Traceability

**执行日期**：2026-09-24；换机复验 2026-09-26；Final Release Gate Preparation 2026-09-26

**规格基线**：`19_TEST_ACCEPTANCE_SPEC.md`  
**代码基线**：`aeba275 Provider 响应分类加固与发布文档对齐`（本文件之后只随文档提交更新，代码未变）

## 1. Result

> **PHASE 8 LOCAL ACCEPTANCE: PASS WITH EXTERNAL RELEASE GATES**

本文件逐项映射正式 acceptance ID。状态含义如下：

- **PASS — automated local**：本机自动测试直接验证产品规则。
- **PASS — manual browser + automated structure**：运行中的 Vite 页面完成浏览器流程，自动测试同时覆盖关键结构或领域规则。
- **PASS — simulated infrastructure**：两个独立 Dexie 数据库、正式 sync worker、Fastify route 与 PGlite PostgreSQL 完成协议集成。
- **RELEASE GATE**：本地实现和测试可通过，但生产参数尚未由产品确定。
- **BLOCKED — external configuration**：需要当前环境没有提供的真实服务凭据。
- **NOT RUN — physical environment**：需要物理设备、系统通知或辅助技术实机。

最终本机 gate 为 **144 passed，1 skipped**（2026-09-26 Final Release Gate Preparation）：domain 11、application 17、storage 32、API 49 passed + 1 real PostgreSQL skipped、Web 35。`pnpm build`、`pnpm lint`、`pnpm format:check` 与 `git diff --check` 均通过；Web 与 API health 运行态均为 HTTP 200。Vite 主 bundle 已降为 348.28 kB（react-vendor 218.83 kB 独立分包），size warning 消失。

## 2. Core Item

- **T-ITEM-001 — PASS — automated local**：`packages/storage/src/acceptance.test.ts` 验证无时间 Item、课程上下文、Overview/Course 同一 identity、Calendar 排除与 Reminder 排除。
- **T-ITEM-002 — PASS — automated local**：同一验收测试验证用户确认后的 `due_at`、Calendar 投影与 Reminder eligibility。
- **T-ITEM-003 — PASS — automated local + manual browser**：同一验收测试验证 COMPLETE、completed ordering 与提醒取消；`apps/web/src/ItemList.test.tsx` 和 Phase 7 浏览器流程验证完成反馈、短暂停留与移动。
- **T-ITEM-004 — PASS — automated local**：同一验收测试验证恢复原 identity、重新排序与提醒重算。
- **T-ITEM-005 — PASS — automated local**：同一验收测试验证 ID/`created_at` 不变，Overview、Course 与 Calendar 同步反映新字段。
- **T-ITEM-006 — PASS — automated local + manual browser**：同一验收测试验证 tombstone、列表隐藏、RawCapture 保留和同 identity Undo；`apps/web/src/ItemDetail.test.tsx` 与浏览器流程验证二次确认。
- **T-ITEM-007 — PASS — automated local**：`packages/storage/src/acceptance.test.ts` 验证 active-window Undo 不重跑解析；`packages/storage/src/storage.test.ts` 验证超时拒绝。

## 3. Overview

- **T-OV-001 — PASS — automated local**：`packages/domain/src/projections.test.ts` 验证所有 INCOMPLETE 位于 completed section 之前。
- **T-OV-002 — PASS — automated local**：同文件验证无时间事项先于有时间事项。
- **T-OV-003 — PASS — automated local**：同文件验证无时间事项按稳定 `created_at` 降序。
- **T-OV-004 — PASS — automated local**：同文件验证有时间事项使用确定性 relevant-time 升序。
- **T-OV-005 — PASS — automated local**：`apps/web/src/ItemList.test.tsx` 验证已完成区默认折叠并显示数量。
- **T-OV-006 — PASS — manual browser + automated structure**：Overview 浏览器验收未出现额外 filter controls；`App`/`ItemList` surface 测试只暴露规格要求的视图结构。
- **T-OV-007 — PASS — automated local**：`packages/domain/src/projections.test.ts` 验证多时间语义排序，并验证编辑不改 `created_at`。

## 4. Course and association

- **T-COURSE-001 — PASS — automated local + manual browser**：本地 storage 流程只用课程名创建 Course；Course index 浏览器流程确认课表不是必填。
- **T-COURSE-002 — PASS — automated local**：`packages/storage/src/storage.test.ts` 与 `apps/api/src/db/resource-coverage.test.ts` 覆盖 CourseInformation create/update/delete。
- **T-COURSE-003 — PASS — automated local**：`packages/storage/src/storage.test.ts` 验证 `COURSE_ITEM` 入口保留 UI course context，不重新猜课。
- **T-COURSE-004 — PASS — automated local/simulated**：`packages/storage/src/storage.test.ts` 与 `apps/api/src/db/course-deletion.test.ts` 验证显式删除关联事项策略和原子执行。
- **T-COURSE-005 — PASS — automated local/simulated**：同两组测试验证 unlink 后 `course_id = null`，Item 继续存在。
- **T-COURSE-006 — PASS — automated local/simulated**：storage 测试验证前一学期 owner-scoped exact-name 候选与明确继承；`apps/api/src/db/course-import.test.ts` 验证导入预览中的 SAME_COURSE/NEW_COURSE 决定、只继承 CourseInformation、不复制历史 Item/旧课表。
- **T-ASSOC-001 — PASS — automated local/simulated**：`packages/storage/src/storage.test.ts`、`apps/api/src/db/collection-sync.test.ts` 与 resource coverage 验证对称 canonical pair、反向去重、list/delete/tombstone，且不传播 Item 状态。

## 5. Calendar

- **T-CAL-001 — PASS — automated local + manual browser**：`packages/domain/src/calendar.test.ts` 和 Calendar 浏览器流程验证 Gregorian 七列月网格与学期周标签。
- **T-CAL-002 — PASS — automated local**：domain calendar test 验证月范围与当前学期 header context。
- **T-CAL-003 — PASS — automated local**：domain calendar test 验证完全位于学期外的月份返回无学期。
- **T-CAL-004 — PASS — automated local**：domain calendar test 验证月份与学期结束日相交时继续显示该学期。
- **T-CAL-005 — PASS — automated local**：domain calendar test 验证只有 SemesterWeek 映射覆盖的周行显示 academic week。
- **T-CAL-006 — PASS — manual browser + automated structure**：`apps/web/src/CalendarView.test.tsx` 与 390×844 浏览器流程验证日期命中 → Single Day → Item Bottom Sheet。
- **T-CAL-007 — PASS — automated local + manual browser**：domain/Web calendar tests 验证一个 Item identity 的连续 occurrence range。
- **T-CAL-008 — PASS — automated local**：domain/storage calendar tests 验证 Calendar 从不读取 CourseSchedule。
- **T-CAL-009 — PASS — automated local + manual browser**：storage acceptance 和 Web day projection 验证完成 Item 留在原日期并用非颜色状态表达完成。
- **T-CAL-010 — PASS — automated local**：domain calendar test 验证没有 occurrence range 时使用 `start_at + due_at` 连续范围。
- **T-CAL-011 — PASS — automated local + manual browser**：domain month derivation与历史月份浏览器流程验证 Calendar context 由可见月份推导，不读取 Overview/Course semester selection。

## 6. Quick Capture

- **T-QC-001 — PASS — manual browser + automated structure**：`apps/web/src/QuickCapture.test.tsx` 验证单一 mounted control；desktop/mobile 浏览器流程验证圆形 `+` 原位向左展开。
- **T-QC-002 — PASS — manual browser + automated structure**：浏览器流程验证本地保存后的轻量 confirmation；`TransientNotice`/QuickCapture tests 验证可访问状态结构。
- **T-QC-003 — PASS — manual browser + automated structure**：浏览器流程验证成功后 input 保持展开和焦点，可连续记录。
- **T-QC-004 — PASS — manual browser**：desktop/mobile 验证外部点击与 Escape 收起并返回 trigger。
- **T-QC-005 — PASS — manual browser**：带未提交文本时外部点击不触发 capture mutation。
- **T-QC-006 — PASS — automated local**：`packages/storage/src/storage.test.ts` 验证只有明确多事项候选才询问，用户决定 split 或 keep-one。

## 7. AI behavior

- **T-AI-001 — PASS — automated local/simulated**：storage preprocessing 与 API interpretation tests 验证明显 Item 走 deterministic path，provider call count 保持 0。
- **T-AI-002 — PASS — automated local/simulated**：同组测试验证明确 CourseInformation 不调用模型且不创建 Item。
- **T-AI-003 — PASS — automated simulated provider**：`apps/api/src/ai/interpretation.test.ts` 验证 ambiguous proposal 只生成待确认候选。
- **T-AI-004 — PASS — automated local**：`packages/storage/src/acceptance.test.ts` 验证 defer 后 RawCapture 保留且不创建 Item。
- **T-AI-005 — PASS — automated local**：同一测试关闭并重新打开 IndexedDB 后，unresolved prompt 仍在列表。
- **T-AI-006 — PASS — automated simulated provider**：interpretation test 注入 provider timeout，RawCapture 保留且 Items 表为空。
- **T-AI-007 — PASS — automated simulated provider**：interpretation test 对 malformed/unsupported factual output 返回错误，不创建正式对象。
- **T-AI-008 — PASS — automated local**：storage split test 验证用户选择 keep-one 时只创建一个 Item。
- **T-AI-009 — PASS — automated local**：storage split test 验证一个 RawCapture、多个 RawCaptureOutput，重复处理不复制输出。
- **T-AI-010 — PASS — automated local**：acceptance/storage tests 验证显式删除 unresolved RawCapture 后不再出现且不创建 Item。

真实 provider 为 **MiMo `mimo-v2.6-flash`**：`pnpm verify:ai` → `PASS interpretation 28240ms`、`pnpm verify:ai --with-import` → `PASS import 37633ms courses=3`（含扫描 PDF 栅格化路径），状态 **VERIFIED REAL**。本地 acceptance 仍独立验证 deterministic boundary、严格 schema 与失败安全；完整自然语言时间理解继续走保守确认路径，生产长期稳定性待持续观察。

## 8. Reminder

- **T-RM-001 — PASS — automated local（R-01 v1）**：application/storage acceptance 验证 timed incomplete Item 进入引擎。
- **T-RM-002 — PASS — automated local（R-01 v1）**：无时间 Item 不产生自动提醒。
- **T-RM-003 — PASS — automated local（R-01 v1）**：test policy 可生成多次提醒。
- **T-RM-004 — PASS — automated local（R-01 v1）**：等级变化使旧事件 stale 并重算未来事件。
- **T-RM-005 — PASS — automated local（R-01 v1）**：完成后未来提醒停止。
- **T-RM-006 — PASS — automated local（R-01 v1）**：删除后未来提醒停止。
- **T-RM-007 — PASS — automated local（R-01 v1）**：due date 改动取消旧逻辑 key 并生成新计划。
- **T-RM-008 — PASS — automated local（R-01 v1）**：未完成逾期事项继续按可配置 policy 产生 continuation。
- **T-RM-009 — PASS — automated local（R-01 v1）**：occurrence 结束后使用独立的低频 continuation rule。
- **T-RM-010 — PASS — automated local（R-01 v1）**：start-time rule 只生成一次事件。

这些结果由 `packages/application/src/reminders.test.ts`、`packages/application/src/reminderPolicy.test.ts`、`packages/storage/src/reminders.test.ts` 和 Item acceptance 提供。R-01 已固化为产品 v1 policy（`r01-v1`），v1 数值本身也有专门验收。

**交付链路补充（2026-09-26）**：`POST /api/v1/devices`、`POST /api/v1/notifications/claim`、`POST /api/v1/notifications/{id}/delivered`、`POST /api/v1/notifications/cancel` 与 `004_reminder_delivery.sql` 已通过 PGlite 自动测试（注册、跨设备 lease 互斥、完成后的 STALE 取消、按 key 取消与 owner 隔离、401）。Web 侧 `ReminderScheduler` 验证到期交付、consume 不改 Item 状态、完成后停止后续提醒；通知权限缺失时回退应用内提示。真实设备通知与后台执行仍为外部 release gap。

## 9. Sync and offline

- **T-SYNC-001 — PASS — automated local/simulated**：本地 capture transaction 先保存 RawCapture/Item/outbox，不需要网络。
- **T-SYNC-002 — PASS — automated local**：storage/sync restart tests 重新打开 Dexie 后保留对象与 outbox。
- **T-SYNC-003 — PASS — simulated infrastructure**：正式 worker 通过 Fastify push/pull，把 A 的离线 Item 同步到 B。
- **T-SYNC-004 — PASS — simulated infrastructure**：lost-response retry 使用同 mutation ID，服务端 idempotency 不复制 RawCapture/Item/revision。
- **T-SYNC-005 — PASS — simulated infrastructure**：`apps/api/src/db/multi-device.test.ts` 验证两端并发 complete 无冲突并收敛 COMPLETE。
- **T-SYNC-006 — PASS — simulated infrastructure**：同测试验证不同 `due_at` 形成只包含该字段的显式 VERSION_CONFLICT。
- **T-SYNC-007 — PASS — simulated infrastructure**：同测试验证一端改时间、另一端改 detail 自动合并并收敛。
- **T-SYNC-008 — PASS — simulated infrastructure**：同测试验证 tombstone 拉取到 B，普通 list 不再返回对象。

更广的 A–K correctness 场景见 `docs/MULTI_DEVICE_VERIFICATION.md`。真实 PostgreSQL、Supabase 与两个独立浏览器 profile 为 **BLOCKED — external configuration**。

## 10. Cross-view consistency

- **PASS — automated local**：`packages/storage/src/acceptance.test.ts` 从 capture 开始，用同一 Item ID 检查 Overview、Course、Calendar、Reminder、edit、complete/restore、delete/Undo 与 RawCaptureOutput；不存在 view-local Item copy。
- **PASS — manual browser**：Phase 7 验证 Search、Calendar、Overview/Course 与 Detail 都打开现有 Item；跨断点详情保持相同 `data-item-id`。

## 11. Cross-platform equivalence

- **PASS — responsive browser simulation**：360–1440px 覆盖 Windows 左侧导航/Mobile 底部导航、Windows Detail container/Mobile Bottom Sheet、Calendar drill-down、Search 和 Quick Capture；证据见 `docs/RESPONSIVE_ACCEPTANCE_MATRIX.md`。
- **PASS — simulated multi-device semantics**：create/edit/complete/date movement/search/detail 共享 canonical data contracts，两个独立 Dexie 设备完成同步 convergence。
- **NOT RUN — physical environment**：没有在物理手机、Windows 设备或两个真实 browser profile 执行完整 create Mobile → read Windows 等矩阵，因此不声明实机 PASS。

## 12. UX and motion

- **PASS — manual browser + automated structure**：完成的勾选/删除线、约 180ms hold、离场和 completed 进入；完成/删除 Undo；Quick Capture 连续展开；Detail 保留来源上下文；Calendar 同 identity 改期到达提示均已验证。
- **PASS — automated local**：`apps/web/src/motion.test.ts` 验证共享 timing 与 reduced-motion 零等待；ItemList、TransientNotice、Calendar tests 验证状态 class 和可访问反馈。
- 物理触控与系统级 reduced-motion 仍属于实机 lane。

## 13. Recovery

- **T-REC-001 — PASS — automated local**：storage test 在 capture 本地 commit 后关闭/重开 IndexedDB，原文和 outbox 保留。
- **T-REC-002 — PASS — automated local/simulated**：pending capture recovery 与 provider timeout/malformed tests 验证 RawCapture 保留，恢复处理或继续 unresolved。
- **扫描版 PDF 导入（ADR-006）— PASS — automated local + VERIFIED REAL**：`apps/api/src/ai/pdf-source.test.ts` 覆盖文本页/栅格页分流、页数与 payload 上限、不可读文件文案；`course-import-provider.test.ts` 覆盖分批与重试；真实 MiMo smoke `pnpm verify:ai --with-import` 返回 `PASS import 37633ms courses=3`。
- **T-REC-003 — PASS — simulated infrastructure**：`apps/api/src/db/course-import.test.ts` 验证 persisted preview 可由新 service instance 恢复、失败解析不写部分 Course、重试可成功、同文件/学期重复 commit 不复制课程。
- **T-REC-004 — PASS — automated local**：acceptance test 验证 deferred ambiguity 重启后重新出现，直到用户明确删除或解决。
- **T-REC-005 — PASS — automated local/simulated**：sync restart test 验证 outbox 重启后继续使用原 mutation identity 并恢复 push/pull。

## 14. Accessibility

- **PASS — manual browser + automated structure**：360px 可见操作目标约 44px；完成状态同时有勾选、删除线和文字；Windows 核心操作可键盘到达；focus-visible、Escape 返回焦点、Mobile modal/Tab loop 与 reduced-motion 均验证。
- **NOT RUN — physical environment**：物理屏幕阅读器、Windows 系统缩放和移动软键盘未执行。浏览器 landmark/ARIA 检查不能替代这些实机项目。

## 14.5 Security limits（AI endpoint rate limit）

- **`RATE_LIMITED` — PASS — automated local**：`apps/api/src/rateLimit.test.ts` 覆盖边界（第 N 次允许、N+1 拒绝）、窗口过期恢复、per-owner 隔离、`Retry-After` 随窗口递减、`AI_RATE_LIMIT_PER_OWNER`/`AI_RATE_LIMIT_WINDOW_MS` 默认与非法值回落。
- **解释端点限流 — PASS — automated local**：`apps/api/src/ai/interpretation-rate-limit.test.ts` 验证确定性路径 5 次全部 200 且 provider 调用数 0（不扣 AI 配额）、AI 路径第 3 次 429 + `Retry-After` + `RATE_LIMITED` + 中文文案、响应不含实现词汇、RawCapture 保留且 Item 数 0、另一 owner 不受影响。
- **导入端点限流 — PASS — automated local**：`apps/api/src/db/course-import.test.ts` 验证首次解析 200、再次 429 + `Retry-After`，job 保持 `READY`、`error_message` 仍为 null、未 commit 任何 Course。
- 规格依据：`16_API_CONTRACT.md` §22.4 与 §19 的 `RATE_LIMITED` 错误码；数字为可配置 security default（ADR-007），非产品行为。

## 15. External release gates

1. **R-01 Reminder numeric policy — RESOLVED（2026-09-26）**：产品 v1 policy 已固化（`REMINDER_POLICY_V1`），quiet hours 23:00–08:00，dedup 60min，"提醒我"默认 HIGH；测试夹具数值仍标注为 fixture。
2. **Platform notification delivery — PARTIALLY IMPLEMENTED / NOT RUN on devices**：device registration、cloud claim/lease、delivery acknowledgement、按 key 取消与浏览器通知适配器已实现（`apps/api/src/db/notifications.test.ts`、`apps/web/src/reminders.test.ts`）；真实设备上的系统通知、后台执行与长时间 lease 生命周期仍未实机执行。
3. **Real PostgreSQL/Supabase — BLOCKED**：缺少 `REAL_DATABASE_URL`、Supabase project/test user/token。
4. ~~Real OpenAI interpretation/import~~ **真实 MiMo interpretation/scanned-PDF import — VERIFIED REAL**（`pnpm verify:ai`、`--with-import`）；生产长期稳定性观察与真实文件（用户真实课表）抽检仍待外部验收 lane 执行。
5. **Physical platform/accessibility — NOT RUN**：物理手机、Windows 设备、屏幕阅读器、系统缩放与软键盘。

当前没有未解决的 P0 规格冲突，也没有发现需要偏离产品语义才能通过的 acceptance item。
