# Real PostgreSQL / Supabase Verification

**状态（2026-09-24）**：准备完成；真实外部执行 **BLOCKED — EXTERNAL CONFIGURATION REQUIRED**。

## 当前环境事实

- 未发现 `docker` 命令。
- 未发现 `psql` 命令。
- 未提供 `DATABASE_URL` 或 `REAL_DATABASE_URL`。
- 未提供 `SUPABASE_URL`、浏览器 publishable key 或 `SUPABASE_ACCESS_TOKEN`。

因此本轮没有把 PGlite 结果标记成真实 PostgreSQL/Supabase 验收。下面的入口已经可重复执行；凭据只通过环境变量提供，不写入仓库。

## 1. 准备开发/验收数据库

使用一个空的、可丢弃的 PostgreSQL 数据库。迁移会创建 Course Manager 表；不要把 `REAL_DATABASE_URL` 指向生产数据库。

```powershell
$env:DATABASE_URL = "postgres://USER:PASSWORD@HOST:5432/DB?sslmode=require"
pnpm db:migrate
```

`db:migrate` 按文件名执行 `backend/migrations/001_initial.sql`、`002_collection_sync.sql`、`003_course_import.sql` 与 `004_reminder_delivery.sql`，并在 `schema_migrations` 记录已应用文件。重复执行不会重复应用迁移。

## 2. 运行隔离的真实 PostgreSQL 集成测试

该测试需要连接账号具有 `CREATE SCHEMA`/`DROP SCHEMA` 权限。它创建随机 schema、应用三份正式迁移（包括 recoverable course import tables）、执行 SemesterWeek collection sync、核对 canonical ID/revision/change-log，最后删除随机 schema。

```powershell
$env:REAL_DATABASE_URL = "postgres://USER:PASSWORD@HOST:5432/DISPOSABLE_DB?sslmode=require"
pnpm test:postgres
```

`pnpm test:postgres` 在缺少 `REAL_DATABASE_URL` 时会失败，而不是用 skipped test 冒充真实验证。普通 `pnpm test` 会把该文件显示为 skipped，以保证无外部服务时的本地套件仍可重复。

## 3. 配置 Supabase Auth + API

服务端只需要数据库 URL 和项目 URL；JWT 通过项目 JWKS 验证。浏览器只允许公开 publishable key，禁止放入 service-role key。

```powershell
$env:DATABASE_URL = "postgres://..."
$env:SUPABASE_URL = "https://PROJECT.supabase.co"
$env:VITE_SUPABASE_URL = "https://PROJECT.supabase.co"
$env:VITE_SUPABASE_PUBLISHABLE_KEY = "PUBLIC_KEY"
pnpm dev
```

在 Web 登录入口输入验收邮箱并完成邮件链接登录。登录后的 JWT subject 是数据 owner ID；API 不接受客户端自行声明 owner。

## 4. 可选开发 seed

seed 只在显式开关开启时运行，并且 `SEED_OWNER_ID` 必须是 Supabase 用户的 UUID。脚本幂等创建一个开发学期和一门课程。

```powershell
$env:DATABASE_URL = "postgres://..."
$env:ALLOW_DEVELOPMENT_SEED = "1"
$env:SEED_OWNER_ID = "SUPABASE_USER_UUID"
pnpm db:seed
```

没有 `ALLOW_DEVELOPMENT_SEED=1` 时脚本会拒绝执行，避免误向数据库写入测试数据。

## 5. 认证 API 的只读 smoke check

从已登录浏览器/验收工具取得普通用户 access token，运行：

```powershell
$env:API_BASE_URL = "http://127.0.0.1:3100"
$env:SUPABASE_ACCESS_TOKEN = "USER_ACCESS_TOKEN"
pnpm verify:live-api
```

脚本验证公开 health、JWT owner identity 和受保护的 change page。它不写数据，也不把 token 输出到日志。

## 6. 真实浏览器双会话验收流程

使用两个独立浏览器 profile（A、B）登录同一账号。不要使用两个 tab 共用同一 IndexedDB。

1. A 断网，Quick Capture “提交报告”；刷新 A，确认 RawCapture/Item 仍存在。
2. A 恢复网络，触发同步；B 登录/恢复前台，确认拉到同一 Item。
3. A 改标题、B 改详情，依次上线，确认自动合并。
4. A、B 同时改标题，确认后一端显示字段冲突；分别验证 LOCAL、REMOTE 和自定义值。
5. 解决后立即在后一端改详情，确认新编辑没有被旧 resolution 覆盖。
6. 重复 delete-vs-edit 与过期 Undo；过期 Undo 必须进入“需要检查”，只能明确采用已同步删除状态。
7. A、B 分别替换同一 Course 的 CourseSchedule，确认界面只让用户选择完整一组，最终两端没有混合成员。
8. 对 SemesterWeek 重复上一步。
9. 关闭并重开两个 profile，确认 cursor、outbox、tombstone 与已解决状态保持收敛。

逐场景记录模板沿用 `docs/MULTI_DEVICE_VERIFICATION.md`：Initial state → Operation sequence → Expected → Actual → PASS/FAIL。

## 7. 完成 gate

只有以下证据齐全时，审计中的“真实基础设施验证”才能从 BLOCKED 改为 PASS：

- `pnpm db:migrate` 在目标 PostgreSQL 成功并显示三份 migration；
- `pnpm test:postgres` PASS；
- `pnpm verify:live-api` 对真实用户 token PASS；
- 两个独立浏览器 profile 完成上述 1–9 并保存 actual result；
- 测试数据属于专用验收 owner/数据库；日志与仓库中没有数据库密码、access token 或 service-role key。
