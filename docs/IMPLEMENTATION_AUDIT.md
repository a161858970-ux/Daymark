# Implementation Audit

**状态**：阶段性审计，更新于 2026-09-23。完整产品和发布验收尚未完成。

## Phase 0 — Specification Assimilation：完成

- 完整读取 README、00–21 和《产品真相基线》，共 24 份 Markdown；按 `21_SPEC_AUDIT.md` 检查实施 gate：PASS，未解决 P0 为 0。
- 用户给定的嵌套路径未存在；对应的实际规格目录为 `C:\Users\leo\Desktop\course_manager_spec\course_manager_spec_v0_1`。
- 交接目录原先没有项目代码、package/lockfile、数据库、backend、认证、通知能力或测试。
- Product/Object/Interaction/State/Data Flow/Architecture/Test 映射写入根目录 `IMPLEMENTATION_CONTEXT.md`。
- R-01 提醒数字策略仍是生产发布 gate，未替产品填写数值。

## Phase 1 — Project Foundation：完成

### Implemented

- pnpm TypeScript workspace、React/Vite 前端、Fastify API、Zod 契约、Dexie 本地数据库、PostgreSQL schema/迁移、Vitest、ESLint、Prettier、环境变量样例。
- 纯 domain 包包含 Item 排序、Overview 学期可见性、Calendar 时间投影、Semester/Week 辅助函数；无需加载 UI 即可测试。
- 本地数据库包含正式对象、RawCapture 多输出、decision、outbox、conflict、删除 Undo、设置及本地恢复上下文；规范实体和物理 schema 的对应关系见迁移。
- Phase 1 结束时 API 仅有公开健康检查；后续 Phase 2 已加入认证保护的部分业务路由。

### Verified

- `pnpm install --frozen-lockfile`、`pnpm dev`、`pnpm build`、`pnpm test`、`pnpm lint`、`pnpm format:check` 均执行成功。
- `pnpm dev` 同时启动前端 5173 和 API 3100；健康检查返回 `{ data: { status: "ok" }, meta: {} }`。
- PostgreSQL 初始迁移已在 PGlite 测试中执行并检查关键约束。尚未在独立 PostgreSQL 实例运行。
- Phase 1 映射 `14_TECHNICAL_ARCHITECTURE`、`15_DATABASE_SCHEMA`、`16_API_CONTRACT`、`19_TEST_ACCEPTANCE`、`20_AGENT_IMPLEMENTATION_PLAN`。

### Technical decision

此次交接明确允许并推荐 React/Vite、Dexie、Fastify/PostgreSQL，替代规格 14 的 Expo/Tauri、SQLite、Supabase 技术推荐方向；语义不变。理由与平台能力限制记于 `ADR-001-platform-and-local-storage.md`。

## Phase 2 — First Vertical Slice：工程闭环完成，云端发布验收待完成

### Implemented

- Quick Capture 先以本地事务持久化原始文本与 outbox，再显示“已记录”；解析在保存后异步运行。
- 明确单一行动生成 Item；课程页上下文优先于文本猜测；唯一字面课程名可关联；明确课程事实生成 CourseInformation。其他输入保留为 unresolved 原文。
- 中断后的 RAW/PROCESSING 记录可恢复，课程页的 context 通过本地元数据保留。待确认记录支持人工归类、具体时间输入、暂不处理和软删除。人工选择写入 RawCaptureDecision，正式输出写入 RawCaptureOutput。
- Overview 与 Course view 读取同一 Item；事项详情可编辑课程、标题、时间、补充内容与提醒等级。完成/恢复、删除二次确认、限时 token Undo 已接入本地持久化和 outbox。
- CourseInformation 可以独立新增、编辑、删除。项目已有手机 Bottom Sheet 与 Windows 左导航/单详情容器的基础布局。
- API 已实现受认证保护的 RawCapture/Course/Item 创建与单对象读取、Item PATCH、完成/恢复、删除与限时 Undo。使用 token subject 做 owner scope、Idempotency-Key 做重放保护、If-Match 做并发检查；非重叠字段编辑自动合并，同字段竞争生成 SyncConflict。具体决策见 `ADR-002-authenticated-api.md`。
- API 新增 Course 集合/单对象、CourseInformation 列表、显式 UNRESOLVED RawCapture 列表、Item 领域筛选与 Overview 集合读取；Calendar 区间查询复用同一 Item 的时间投影。受认证的 sync push/pull 使用客户端 UUID、依赖顺序和 owner scope。同步覆盖当前本地链路的 RawCapture、Course、Item、CourseInformation、RawCaptureOutput/Decision 创建，以及 RawCapture、Item、CourseInformation 的现有编辑/删除操作。浏览器已接入可选 Supabase Auth 会话监听：有配置及会话时启动 worker；记录依然先落本地。同步决策见 `ADR-003-sync-core.md`。
- 本地 sync worker 保留持久顺序，断网时保留 outbox，成功后 ACK，事务性拉取后才推进游标。首次认证将离线 owner 绑定到 token owner，已绑定数据拒绝切换为另一账号；真正同字段竞争保留待处理 mutation 与服务器冲突记录。

### Verified

- 自动测试覆盖原文重启留存、同一 Item 跨视图、编辑 provenance、完成/删除/Undo、超时拒绝、含时间输入 unresolved、明确课程信息、课程上下文重启恢复、人工决定与多输出关系结构、owner-scoped 字面课程匹配、日程投影和数据库约束。
- Phase 2 结束时 26 项自动测试通过，覆盖旧版 Dexie outbox 迁移、离线重启、同步整链路与跨设备同字段冲突。后续 Phase 3 增加的测试见下节。
- 手动在本地浏览器验证：快速记录、本地持久化与重载、课程页事项、详情原文、完成/恢复、删除确认/撤销、课程信息、待确认分类、时间编辑重载保留；手机/桌面基础布局均已查看。

### 后续阶段与发布验收仍需处理

- API 仍未覆盖全部资源；课程信息普通 REST 等接口尚未完成。Web 缺少账号登录入口，且无真实 Supabase/PostgreSQL 配置；默认用户界面仍只在本地运行。有会话时的自动触发代码尚未在真实账号下验证。PGlite + IndexedDB 整链路测试已证明协议可贯通，但不能代替真实账号/网络验收。
- 当前同字段冲突会保留在服务器与本地 outbox 中，尚无冲突读取/解决 UI；离线删除后若服务器 Undo 窗口已经过期，客户端会保留待处理错误，仍需专门恢复流程。不能宣称多设备收敛完成。
- 当前集合读取会在服务端内存中过滤/排序，使用对象 ID 定位下一页；若翻页期间锚点被删除，游标会失效。生产级稳定分页与规模测试尚未完成。
- 解析器只覆盖安全的确定性子集；复杂多事项、AI、完整时间理解要在后续 AI 阶段处理。当前手动分类可保存原意，仍缺完整的拆分候选流程。
- 未在真实 PostgreSQL、真实离线/重新联网、多设备或安装后的 Windows/Mobile 环境验证。Phase 2 的本地 UI 链路及模拟认证 API 联调已完成；不能据此宣称生产云端或跨平台验收通过。

## Phase 3 — Course / Semester / Calendar：手工数据主链路已闭环，导入与云端并发验收未完成

### Implemented

- Semester 创建、当前/历史学期视角、课程自动归属当前学期；Overview 默认保留无课程事项和历史未完成事项，历史完成事项只在所选学期显示。
- owner-scoped 严格同名的此前学期候选检测；用户明确确认后仅继承有效 CourseInformation，不复制 Item 或 CourseSchedule。当前学期同名课程给出重复提示。
- Semester Week 手工映射与校验；CourseSchedule 独立存储和编辑，课程页显示，Calendar 不读取它。
- Calendar 月/周视图、周导航、移动端日期下钻；月份派生学期标签，映射派生学期周；无时间 Item 不显示，完成 Item 保留位置；多日范围仍是同一个 Item。
- 课程删除时展示关联事项并要求明确选择“删除事项”或“解除课程关联”。本地事务和受认证 REST/sync 命令均原子执行，RawCapture 继续保留。
- REST 补齐 Semester create/list/get/patch、Weeks list/replace、CourseSchedule list/atomic replace、Course delete-with-strategy；直接写入 canonical 数据和同步 change log。同步支持 Semester、Week、CourseSchedule 与 Course 删除命令。

### Verified

- 当前自动测试：domain 7、storage/application 18、API/migration/auth/sync 10，共 35 项通过。覆盖学期/历史 Overview、跨学期继承、周次范围、Calendar range/排除 CourseSchedule、课表本地与服务端替换、课程两种删除策略、owner/版本/幂等约束。
- `pnpm test`（先 build 后测试）、`pnpm lint`、`pnpm format:check` 均通过。API PGlite 测试串行运行，避免多个嵌入式数据库测试争用造成 5 秒超时。
- 手动浏览器验证：创建学期/课程、课程安排、周次标签、Calendar 月/周导航与同一 Item 详情；课程删除确认准确列出两条关联事项和两种策略，随后取消。另在前一轮核对了移动端日历下钻和详情 Bottom Sheet。
- `pnpm dev` 运行，Web 返回 HTTP 200，API `/api/v1/health` 返回 `ok`。

### 尚未闭合的验收

- PDF/图片课程表导入与人工核对尚未实现；对应 `20_AGENT_IMPLEMENTATION_PLAN.md` 后续导入阶段。手工 CourseSchedule 已可用。
- 本地课表/周次替换为单事务，但 sync outbox 逐实体上传；REST 替换本身原子。跨设备并发替换的集合级冲突及中间状态隔离须在 Phase 6 完成。
- 尚无真实 Supabase/PostgreSQL 环境和多设备验收；课程删除并发变化目前返回显式版本冲突，尚无面向用户的冲突解决界面。

## Phase 4 — AI Pipeline：实现候选解释与确认链路，真实模型验收待完成

### Implemented

- 共享纯预处理按 UI 课程上下文、课程名、安全的确定性事项/信息规则处理输入；原始 RawCapture 文本不改写。保守检测明显的多个行动，只显示拆分候选，不自动拆分。
- 用户确认拆分时，一个本地事务创建多个 Item、多个 RawCaptureOutput 和一条 SPLIT 决策，所有对象进入 outbox；相同决定重放返回原对象。拒绝拆分时记录 KEEP_ONE 并只创建一个 Item。
- 认证保护的 `/api/v1/ai/capture-interpretations` 只读取 owner-scoped RawCapture 和相关课程/学期上下文，确定性结果不调用模型。需要语义理解时通过服务端 OpenAI Responses 结构化输出适配器调用，使用共享 Zod 契约在服务端和客户端校验。模型解释只返回候选；正式对象仍需 application 层和用户确认。
- 模型响应还检查文本片段和课程候选是否有来源；没有时间表达的输入不能凭空带出时间。调用异常或非法响应不删除 RawCapture，也不创建正式 Item。普通日志不记录原文。
- 用户界面在已配置账号会话时提供“尝试智能整理”，先同步本地 RawCapture，再请求解释；建议填入待确认表单，用户仍可改写、保持一条、拆分或暂不处理。

### Verified / limitations

- 本地与 API 自动测试覆盖明显输入不调用模型、明确多事项候选、拆分/拒绝拆分 provenance、重复处理不产生重复 Item、鉴权与 owner scope、歧义结果、无效结构、无事实来源的候选、超时和原文留存。
- 手动在本地浏览器走通“找学姐要笔记，提交报告”的拆分确认与保持一条两条路径，分别得到两条和一条 Item。
- 服务端密钥、真实模型、真实账号和外部 PostgreSQL 均未提供，因此没有在线 AI 端到端验收；模型配置只保留接口和开发环境示例。时间语义仍采用保守确认路径，尚无完整自然语言时间解析。此阶段不能宣称 AI 发布验收完成。

## Phase 5 — Reminder Engine：可配置核心已验证，生产送达待发布参数与平台接入

### Implemented

- `ReminderPolicy` 接口注入 NORMAL/HIGH 的提前提醒与逾期/发生后续提醒间隔、开始时间偏移、每日上限和去重窗口；运行时代码没有生产默认数字，R-01 未被填写。
- 纯计划函数只处理有时间、未完成、未删除且提醒等级非 OFF 的 Item；分别处理 due、occurrence 和 start 语义。安静时段和本地日期由平台适配器提供，按配置限制每日候选数。
- 稳定逻辑 key 和 Item 时间快照支持重排、失效与发送前 stale guard；同一逻辑送达不可重复发送。协调器通过注入的 claim/deliver/cancel 端口处理跨设备租约与设备通知边界，点击通知时重新读取当前 Item，不修改完成状态。
- Dexie v4 新增设备本地的派生提醒计划缓存；重启后保留状态，Item 时间变化、完成等操作可重算并取消旧计划。

### Verified / limitations

- 当前 44 项自动测试通过：domain 7、application/reminder 4、storage 21、API 12；提醒测试覆盖有时间/无时间、完成/删除、等级变化、截止时间修改、逾期续提醒、发生结束后续提醒、单次开始提醒、安静时段、每日上限、stale guard、逻辑去重及本地重启恢复。
- `pnpm test` 包含全工作区构建，`pnpm lint` 和 `pnpm format:check` 通过。`pnpm dev` 现在先构建再启动前端与 API；在当前 Windows 环境下用 TypeScript watch + Node watch 代替会触发系统用户信息错误的 tsx watch。Web HTTP 200，API 健康检查 `ok`。
- 没有接入真实 Windows/Mobile 通知平台，也没有启用生产提醒。共享 claim/lease 的云端实现、真实时区与安静时段设置、后台执行及 R-01 产品数字均待完成。提醒相关的生产验收仍阻塞。

## Phase 6 — Offline / Sync / Conflict：字段冲突闭环完成，完整多设备验收未完成

### Implemented

- 新增受 owner scope 保护的冲突列表、详情和解决 API。解决要求 Idempotency-Key、已查看对象的 If-Match 版本与全部冲突字段的选择；选择本机、云端或显式值后生成正常实体修订和 change log，不能通过该接口任意恢复已删除对象。
- Item、CourseInformation、RawCapture 字段设白名单并校验最终实体。Item 删除竞争使用软删除及 token-bound 短时 Undo，不把“删除”语义标记误写为时间戳。
- IndexedDB 在事务中确认被拒的 outbox mutation，记录新服务端版本；同一对象有后续本机修改时保留本机状态并继续上传。启动时读取已解决冲突，避免重放原来幂等的 CONFLICT 结果；服务端成功但响应丢失时可读取最终记录恢复。
- Pull 页若与拉取期间新产生的本地 mutation 重叠，会保持整个页和游标不变，等待该 mutation 先上传；避免跳过远端字段后永久丢失变更。
- 界面只展示对象、真正冲突字段、本机值和当前云端值，由用户逐字段选择。配置 Supabase 时提供邮箱登录链接与退出入口；未配置时保持纯本地记录。
- 非冲突的永久拒绝会明确提示“本机仍保留”，账户面板可人工重试；目前没有安全地编辑或移除被拒 mutation 的修复界面。
- 决策与边界记于 `docs/ADR-004-conflict-resolution.md`。

### Verified / limitations

- 当前 48 项自动测试通过：domain 7、application 4、storage 23、API 12、Web 2。PGlite + fake IndexedDB 往返测试覆盖 Item、CourseInformation、RawCapture 的冲突解决，以及所属权隔离、旧版本拒绝、非法选择、幂等重放、后续本机编辑保留、拉取游标竞态、删除冲突与 Undo；Web 测试核对只展示冲突字段，并在云端对象已删除时禁用本机覆盖。`pnpm build`、`pnpm lint`、`pnpm format:check` 通过；运行中的 Web 返回 200，API 健康检查返回 `ok`。
- 尚无真实 Supabase/PostgreSQL 账号和两设备环境，登录、实时恢复与收敛未做线上验收。课表/周次的逐实体 outbox 尚无集合级并发替换隔离；部分非冲突拒绝会停在 `ACTION_REQUIRED`，目前只能人工重试，仍缺可修复记录的界面；后台执行、断线长时间重试和完整实体变更覆盖未通过发布验收。
- 下一步需将 CourseSchedule 与 SemesterWeek 的“替换整组”表示为单条可幂等的 sync command，保留客户端对象 ID、比较替换前集合，并在同一服务端事务中写入变更；并发改动要形成可选择的集合冲突。当前逐行上传不能保证这条语义，因此暂不宣称 Phase 6 完成。

## 后续阶段状态

- Phase 4 AI Pipeline：服务端适配器和用户确认链路已实现，真实模型/账号验收待完成；当前不把猜测写成事实。
- Phase 5 Reminder Engine：策略接口、派生计划、本地缓存、发送前校验与注入式送达边界已实现；设备通知/云端租约和 R-01 仍未完成。
- Phase 6 Offline/Sync/Conflict：已补冲突 API、按字段选择 UI、冲突解决后的本地 outbox 衔接和可选账号入口；集合级并发、非冲突拒绝修复界面及真实多设备验收尚未完成。详见下节。
- Phase 7 Visual/Responsive/Motion：已有基础布局，尚未按 11–13 完成精细视觉、动效与双平台验收。
- Phase 8 Acceptance：未执行 `19_TEST_ACCEPTANCE_SPEC.md` 全量验收。

## 当前发布阻塞

1. 业务 API、认证、同步、冲突处理与跨端恢复未完成。
2. 真实 AI 模型验收、生产提醒送达、Search、课程表导入、跨设备集合级同步与完整响应式/动效未完成。
3. R-01 具体提醒数字未获产品确认，不能宣称生产提醒策略完成。
4. 真实 PostgreSQL 集成、设备通知、Windows/Mobile 平台测试与全量 acceptance 未完成。

## Spec deviation

目前没有已知的产品语义偏差。技术栈选择来自本次用户交接，记录于 ADR。当前的功能缺口均如上显式列出，不能视为已通过规格验收。
