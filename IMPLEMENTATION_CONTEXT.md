# Implementation Context

- **项目**：大学生课程与事项管理工具
- **规格来源**：桌面 `course_manager_spec/course_manager_spec_v0_1` 中全部 24 份 Markdown（README、00–21、《产品真相基线》）
- **Phase 0 结论**：`21_SPEC_AUDIT.md` 的实施 gate 为 PASS；无未解决 P0。R-01 提醒数值策略仍是生产发布 gate。

## 1. Product Map

产品支持快速记录、按全局/课程/时间查看、主动完成与提醒。日常默认页是**不按课程分组**的事项总览；课程页负责按课程核对，日程只是同一批有时间 Item 的投影。可以记录无课程、无时间事项。课程表的 CourseSchedule 不进入日程。搜索是定位入口。产品不做学习规划、优先级、Dashboard、标签树、课表替代或 AI 教练。

## 2. Object / State Map

- `Semester` 包含课程上下文和显式 `SemesterWeek` 映射；假期不建假学期。
- `Course` 是学期内的课程实例；`semester_id` 可空；`CourseSchedule` 是课程属性，`CourseInformation` 是无完成状态的统一信息列表。
- `Item` 是唯一可操作身份，`course_id` 与所有时间字段可空；正式状态仅 `INCOMPLETE` / `COMPLETE`。`ItemAssociation` 是对称关系，不传递完成状态。
- `RawCapture` 永存输入原文，状态为内部的 `RAW / PROCESSING / RESOLVED / UNRESOLVED / DELETED`。`RawCaptureOutput` 是一对多 provenance 链，可指向 Item 或 CourseInformation；`RawCaptureDecision` 记录用户选择。Item 编辑/删除不改写或顺带删除原文。
- `Reminder` 是基于 Item、策略与当前时间推导的 delivery，不是第三种 Item 状态。同步的 outbox、cursor、tombstone、revision、conflict 都是基础设施状态；同字段互斥编辑需要显式选择。

## 3. Data / Interaction Map

`UI context → 本地 RawCapture 事务提交 → ✓ 已记录 → deterministic/normalized parsing → 仅必要时 AI → 实质歧义轻问 → 用户选择 → RawCaptureOutput + 正式对象 → Overview / Course / Calendar / Reminder`。

课程页输入优先采用当前 Course；明确输入直接成 Item 或 CourseInformation。多事项仅提出拆分候选；拒绝拆分后只建一个对象。AI 失败或中断后保留 RawCapture，下次恢复 unresolved。Quick Capture 在右下 `+` 原地向左展开、连续记录、点击外部收起。事项主体开同一个详情容器，独立完成控件负责完成；详情内编辑、恢复、删除（二次确认）及限时 Undo。手机详情为 Bottom Sheet，Windows 为单个持久侧容器。

## 4. Projection / Invariant Map

- 默认 Overview：当前学期课程 Item + 所有无课程 Item + 历史学期未完成课程 Item；旧学期已完成课程 Item 不混入。未完成中无时间先按 `created_at DESC`，有时间按查询时派生 `overview_sort_at`；已完成默认折叠。
- Calendar 仅投影 Item：优先 occurrence range；否则 `start_at + due_at` 连续区间；否则相关单点。多日仍是一个 Item ID。月顶部学期标签从可见月份计算，周次来自 SemesterWeek；CourseSchedule 永不投影。
- 删除为 tombstone；限时 `undo-delete` 与详情中的状态 restore 分开。RawCapture 独立保留。Course 删除必须由用户选择级联删除 Item 或解绑保留。
- 本地提交先于 UI 成功反馈；outbox 幂等推送、游标拉取、字段级并发合并/冲突处理。通知发送前作 stale guard；查看通知不改变 Item 状态。

## 5. Architecture / Technology

采用用户在本次交接明确给出的默认方向：pnpm + TypeScript workspace；React/Vite 响应式前端；IndexedDB/Dexie 本地存储；Node/Fastify API；PostgreSQL 迁移；Zod 契约；Vitest/Playwright 验证。正式规格 `14_TECHNICAL_ARCHITECTURE.md` 推荐的 Expo/Tauri + SQLite + Supabase 是技术推荐基线；本次用户明确允许/优先 React/Vite、Dexie、Fastify，故以当前选择建立适配器边界，**不改变**产品的 Mobile/Windows 布局或业务语义。原生通知与打包需要在对应阶段用平台适配器实现和验证。

层次：`UI → application use cases → pure domain/contracts → repository interfaces → local Dexie / API + PostgreSQL`。UI 不直接访问数据库、AI、同步协议。一个 Item 实体经查询函数投影到所有视图。服务端 owner scope、认证、幂等、乐观并发必须在功能阶段真实实现，不能用客户端隐藏代替。

建议目录：`apps/web`、`apps/api`、`packages/domain`、`packages/contracts`、`packages/application`、`packages/storage`、`packages/sync`、`packages/reminders`、`packages/ai`、`backend/migrations`、`docs`、`tests`。

## 6. Phase / Test Map

1. **Foundation**：安装、运行、构建、测试均可执行；纯 domain 测试可在不加载 UI 时运行；数据库 schema 用迁移表示。
2. **First slice**：本地保存 RawCapture、确定性建 Item、Overview/Course 同一对象、完成、删除/Undo；测试断网、重启、跨视图一致性和限时 Undo。
3. **Course / Semester / Calendar**：课程信息、课程安排、历史学期、导入/同名确认、月周日投影；测试旧学期过滤与 CourseSchedule 排除。
4. **AI**：仅在规则不足时调用，Zod 校验、多输出 provenance、歧义/拆分决定及失败恢复；测试无模型调用的明确输入和重放不重复。
5. **Reminder**：可配置策略、取消/重算、安静时段、去重、过期 guard；使用测试 fixture 验证，R-01 未定前不得宣称生产提醒策略完成。
6. **Sync**：outbox、cursor、幂等、tombstone、字段级冲突；测试双端同状态收敛、非重叠合并、同字段冲突。
7. **Visual / Responsive / Motion**：依据 11–13 实现手机/Windows 空间适配、完成时序、详情容器、reduced-motion；双 viewport 人工核查。
8. **Acceptance**：逐条对应 `19_TEST_ACCEPTANCE_SPEC.md`，生成 `docs/IMPLEMENTATION_AUDIT.md`，列出通过项、未完成项与发布阻塞。

每一阶段只有在代码、build、test、run、手动核对和阶段报告形成闭环后才能标记完成。阶段计划以本次交接给出的 0–8 顺序执行，同时覆盖 `20_AGENT_IMPLEMENTATION_PLAN.md` 的工程 gate。

## 7. 实施前 Gate / 真正阻塞项

`21_SPEC_AUDIT.md` 中 A-01–A-21 的决定作为实现约束：尤其 Bottom Sheet、`raw_capture_outputs`、限时删除 Undo、overview 排序、跨学期同名确认和日程投影优先级。**Phase 1 无产品决策阻塞。** R-01 是生产提醒发布 gate，不是可自行填写的数字。当前机器没有 PostgreSQL/ Docker/psql；迁移可以编写并静态校验，真实数据库集成验证在具备数据库环境后执行。当前目录原先没有 package、锁文件、前后端或数据库，也没有可复用旧代码。
