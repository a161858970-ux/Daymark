# 课程与事项管理

这是依据 `course_manager_spec_v0_1` 施工中的课程记录应用。当前已完成规格吸收、工程骨架、本地优先记录链路、学期/课程/手工课表/日历主链路、AI 解释与用户确认拆分、可配置提醒引擎核心，以及 Phase 6 的同步协议实现。真实 PostgreSQL/Supabase 和物理设备验收仍受外部配置阻塞，因此 Phase 6 状态保持 **PARTIALLY COMPLETE**。范围与证据见 [`docs/IMPLEMENTATION_AUDIT.md`](docs/IMPLEMENTATION_AUDIT.md)。

## 运行

需要 Node.js 24 与 pnpm 11。项目在 Windows PowerShell 下验证。

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

前端运行在 `http://127.0.0.1:5173`，API 健康检查运行在 `http://127.0.0.1:3100/api/v1/health`。同时配置 `DATABASE_URL` 与 `SUPABASE_URL` 后，API 才注册认证业务路由，包括 RawCapture、Course、Item 的部分 CRUD、sync push/pull 与冲突解决。前端日常界面先使用 IndexedDB；同步 worker 与 HTTP 适配器已有整链路集成测试。配置浏览器公开的 Supabase URL/key 时，界面提供邮箱登录链接入口，有会话后在启动、回到前台和网络恢复后运行同步；目前未提供真实项目配置，因此默认运行仍是本地模式。清除该站点数据会删除当前本地记录。开发时请使用独立的浏览器配置文件或保留数据备份。

```powershell
pnpm build
pnpm test
pnpm lint
pnpm format:check
```

PostgreSQL 迁移由 `DATABASE_URL` 指定连接后执行 `pnpm db:migrate`。真实 PostgreSQL 隔离测试使用 `REAL_DATABASE_URL` 和 `pnpm test:postgres`；缺少 URL 时该命令会明确失败。开发 seed 使用 `ALLOW_DEVELOPMENT_SEED=1`、`SEED_OWNER_ID` 和 `pnpm db:seed`。真实认证 API 的只读 smoke check 使用 `pnpm verify:live-api`。完整步骤见 [`docs/REAL_POSTGRES_VERIFICATION.md`](docs/REAL_POSTGRES_VERIFICATION.md)。

AI 解释接口只在已配置认证和数据库的 API 上注册；设置服务端 `OPENAI_API_KEY` 和 `OPENAI_MODEL` 才会调用模型。未设置密钥时，确定性解析和手动确认仍可使用。环境变量示例见 `.env.example`。

## 目录

- `apps/web`：React/Vite 界面，仅调用 application use cases。
- `apps/api`：Fastify API、JWT 验证、PostgreSQL 访问、迁移、部分业务接口与首条 sync push/pull 链路。
- `packages/domain`：纯实体、总览排序、日程投影和学期可见性规则。
- `packages/contracts`：Zod 输入契约。
- `packages/application`：记录、解析安全子集、事项/课程信息操作、outbox 写入和同步 worker。
- `packages/storage`：Dexie/IndexedDB 本地持久化、身份绑定、outbox 顺序与 pull 事务。
- `backend/migrations`：正式数据库结构。
- `IMPLEMENTATION_CONTEXT.md`：规格到架构的映射。
- `CURRENT_IMPLEMENTATION_STATE.md`：当前代码事实、证据和 blocker。
- `docs/IMPLEMENTATION_AUDIT.md`：阶段验收、限制与发布阻塞。
- `docs/SYNC_ENTITY_MATRIX.md`：逐实体同步能力核对。
- `docs/MULTI_DEVICE_VERIFICATION.md`：A–K 多设备协议场景的 initial/operations/expected/actual/result。
- `docs/ADR-005-collection-replacement-sync.md`：课表与学期周整组替换协议。

## 当前行为边界

快速记录先保存原文。明确单一行动可自动形成 Item，明确课程事实可形成 CourseInformation；有时间语义或分类不清的输入保留为待确认记录，由用户决定。明确多个行动时只提出拆分候选；用户选择拆分后，一条 RawCapture 可关联多个 Item；选择保持一条则只创建一个 Item。人工编辑时间不会改写原文。课程安排单独保存，不进入日历；日历只投影有时间的 Item。

同步冲突支持本机值、已同步值和显式值；远端已删除对象不能经冲突接口任意恢复。CourseSchedule 与 SemesterWeek 使用单 command、collection version、替换前快照、单事务与单 envelope 的整组同步。永久拒绝的 mutation 进入可检查的 ACTION_REQUIRED 流程，用户可重交当前内容或明确采用已同步状态，决定会保留 provenance。当前 A–K 协议场景已在两个独立 Dexie 数据库 + Fastify + PGlite 中通过；旧 IndexedDB v5 → v6 升级演练已本地通过。真实 PostgreSQL/Supabase 与物理设备生命周期仍待外部环境验证。

当前解析器只覆盖安全的确定性子集；AI 解释需要在线账号、服务端密钥和用户确认，未在真实模型上验收。提醒计划引擎已有纯逻辑和本地缓存，生产数字策略仍是 R-01 gate，尚未接通设备通知/云端 lease。全局本地关键词搜索已实现，并直接定位同一 Item、Course 或 CourseInformation；完整时间解析和课表导入尚未实现。
