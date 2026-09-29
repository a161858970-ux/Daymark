# 课程与事项管理

这是依据 `course_manager_spec_v0_1` 实现的课程记录应用。当前已完成规格吸收、工程骨架、本地优先记录链路、学期/课程/课表/日历主链路、可恢复的课程导入、AI 解释与用户确认拆分、可配置提醒引擎核心、离线同步协议，以及 Phase 7 的最终视觉/响应式/动效实现。Phase 8 本地 acceptance 已逐项执行；真实环境验收已推进到 A 真实 PostgreSQL 3.5/4、B Supabase 认证（含手机号短信）5/5、C 双 profile 同步 14/14、D Windows 物理 8/8，均以 `docs/FINAL_RELEASE_VALIDATION.md` 的真实证据收官，**剩余 E 段手机真机 8 项与 F3/F4 手机 TalkBack**。范围与证据见 [`docs/IMPLEMENTATION_AUDIT.md`](docs/IMPLEMENTATION_AUDIT.md) 与 [`docs/ACCEPTANCE_TRACEABILITY.md`](docs/ACCEPTANCE_TRACEABILITY.md)。

## 运行

需要 Node.js 24 与 pnpm 11。项目在 Windows PowerShell 下验证。

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

前端运行在 `http://127.0.0.1:5173`，API 健康检查运行在 `http://127.0.0.1:3100/api/v1/health`。同时配置 `DATABASE_URL` 与 `SUPABASE_URL` 后，API 才注册认证业务路由，包括 RawCapture、Course、Item 的部分 CRUD、sync push/pull 与冲突解决。前端日常界面先使用 IndexedDB；同步 worker 与 HTTP 适配器已有整链路集成测试。配置浏览器公开的 Supabase URL/key 时，界面提供账户登录（Auth v1）：默认入口为手机号验证码，次要入口为 Google OAuth，邮箱登录（验证码 / 密码）为第三级折叠入口；登录方式在「账户与同步」内绑定与管理。账户模型为「一个 `auth.users.id` = 一个账户 = 多个登录身份（手机号 / 邮箱 / Google + OTP 或密码）」，业务数据 owner 始终是 `auth.users.id`，切换登录方式不会迁移或重绑本机数据。有会话后在启动、回到前台和网络恢复后运行同步；当前默认运行仍是本地模式，真实邮件 / 短信 / Google 验收按 [`docs/AUTH_REAL_VALIDATION.md`](docs/AUTH_REAL_VALIDATION.md) 执行。清除该站点数据会删除当前本地记录。开发时请使用独立的浏览器配置文件或保留数据备份。

```powershell
pnpm build
pnpm test
pnpm lint
pnpm format:check
```

PostgreSQL 迁移由 `DATABASE_URL` 指定连接后执行 `pnpm db:migrate`。真实 PostgreSQL 隔离测试使用 `REAL_DATABASE_URL` 和 `pnpm test:postgres`；缺少 URL 时该命令会明确失败。开发 seed 使用 `ALLOW_DEVELOPMENT_SEED=1`、`SEED_OWNER_ID` 和 `pnpm db:seed`。真实认证 API 的只读 smoke check 使用 `pnpm verify:live-api`。完整步骤见 [`docs/REAL_POSTGRES_VERIFICATION.md`](docs/REAL_POSTGRES_VERIFICATION.md)。

AI 解释和 PDF/图片课程导入解析只在已配置认证、数据库与 `AI_API_KEY` 的 API 上调用 provider。provider 使用 OpenAI 兼容的 Chat Completions 接口，默认 `AI_BASE_URL=https://api.xiaomimimo.com/v1`、`AI_MODEL=mimo-v2.6-flash`（MiMo）；PDF 源按页处理：有文本层走页文字，无可信文本层（扫描版）则栅格化为受控尺寸图片后按 base64 图片输入（见 `docs/ADR-006-scanned-pdf-import.md`）。导入先生成可恢复预览，要求用户处理跨学期同名候选，再原子提交；原始文件字节不持久化。未设置外部服务时，确定性解析、手动确认、手工课程和手工 CourseSchedule 仍可使用。AI 端点在服务端按 authenticated owner 限流（默认 20 次/分钟，`AI_RATE_LIMIT_PER_OWNER` / `AI_RATE_LIMIT_WINDOW_MS` 可配；触发返回 `RATE_LIMITED` + `Retry-After`，确定性解析不占配额，见 `docs/ADR-007-ai-rate-limit.md`）。环境变量示例见 `.env.example`；真实环境验收步骤见 `docs/FINAL_RELEASE_VALIDATION.md`。

## 目录

- `apps/web`：React/Vite 界面，仅调用 application use cases。
- `apps/api`：Fastify API、JWT 验证、PostgreSQL 访问、课程导入/AI adapters、正式业务接口与 sync push/pull/conflict 链路。
- `packages/domain`：纯实体、总览排序、日程投影和学期可见性规则。
- `packages/contracts`：Zod 输入契约。
- `packages/application`：记录、解析安全子集、事项/课程信息操作、outbox 写入和同步 worker。
- `packages/storage`：Dexie/IndexedDB 本地持久化、身份绑定、outbox 顺序与 pull 事务。
- `backend/migrations`：正式数据库结构。
- `IMPLEMENTATION_CONTEXT.md`：规格到架构的映射。
- `CURRENT_IMPLEMENTATION_STATE.md`：当前代码事实、证据和 blocker。
- `docs/IMPLEMENTATION_AUDIT.md`：阶段验收、限制与发布阻塞。
- `docs/ACCEPTANCE_TRACEABILITY.md`：`19_TEST_ACCEPTANCE_SPEC.md` 每个 acceptance ID 的证据与状态。
- `docs/SYNC_ENTITY_MATRIX.md`：逐实体同步能力核对。
- `docs/MULTI_DEVICE_VERIFICATION.md`：A–K 多设备协议场景的 initial/operations/expected/actual/result。
- `docs/ADR-005-collection-replacement-sync.md`：课表与学期周整组替换协议。

## 当前行为边界

快速记录先保存原文。明确单一行动可自动形成 Item，明确课程事实可形成 CourseInformation；有时间语义或分类不清的输入保留为待确认记录，由用户决定。明确多个行动时只提出拆分候选；用户选择拆分后，一条 RawCapture 可关联多个 Item；选择保持一条则只创建一个 Item。人工编辑时间不会改写原文。课程安排单独保存，不进入日历；日历只投影有时间的 Item。

同步冲突支持本机值、已同步值和显式值；远端已删除对象不能经冲突接口任意恢复。CourseSchedule 与 SemesterWeek 使用单 command、collection version、替换前快照、单事务与单 envelope 的整组同步。永久拒绝的 mutation 进入可检查的 ACTION_REQUIRED 流程，用户可重交当前内容或明确采用已同步状态，决定会保留 provenance。当前 A–K 协议场景已在两个独立 Dexie 数据库 + Fastify + PGlite 中通过；旧 IndexedDB v5 → v6 升级演练已本地通过。真实 PostgreSQL/Supabase 与 Windows 物理生命周期已通过真实验收（A/B/C/D 段）；**物理手机矩阵与移动端屏幕阅读器（E 段 8 项、F3/F4）仍待实机执行**。

当前本地解析器只覆盖安全的确定性子集；AI 解释需要在线账号、服务端密钥和用户确认，确定性规则优先、失败不建正式对象。已用真实 MiMo provider 完成 smoke 验收：`pnpm verify:ai`（可加 `--with-import`），未配置密钥时该命令输出 `REAL_AI_REQUIRED` 而不是伪造通过。课程导入的 job/preview/duplicate decision/atomic commit/recovery 已实现；扫描版 PDF 无文本层时按页栅格化为受控尺寸图片后走同一 structured preview 流程（见 `docs/ADR-006-scanned-pdf-import.md`）。提醒计划引擎按产品 v1 policy（R-01）运行，跨设备 lease 与 delivery acknowledgement 已接通。全局本地关键词搜索已实现，并直接定位同一 Item、Course 或 CourseInformation。

提醒交付链路已接通：本地 ReminderEngine 从 Item 时间与 `ReminderPolicy` 派生计划，在线时先向 `POST /api/v1/notifications/claim` 申请跨设备 lease，避免手机与 Windows 重复提醒，发送后经 `POST /api/v1/notifications/{id}/delivered` 确认，设备通过 `POST /api/v1/devices` 注册；完成、删除与改期会在下一次 reconcile 中取消对应逻辑提醒。离线或未登录时直接本地交付，保证提醒不丢。浏览器 Notification 作为 Windows/移动 Web 的通知适配器，无权限时回退为应用内提示；通知点击打开当前 Item 详情（不读取旧快照）并消费该次通知。提醒数值已按 R-01 固化为产品 v1 policy（`packages/application/src/reminderPolicy.ts`），默认生效；`VITE_REMINDER_POLICY` 只作为实验/测试覆盖项，安静时段默认 23:00–08:00。
