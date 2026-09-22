# ADR-003 — 首条本地到服务端同步链路

**状态**：部分实现，2026-09-22；真实账号与多设备验收待完成。

## 依据

`08_SYNC_OFFLINE_SPEC.md`、`15_DATABASE_SCHEMA.md`、`16_API_CONTRACT.md`、`17_SYNC_NOTIFICATION_ENGINEERING.md` 和 `21_SPEC_AUDIT.md` 要求本地先保存、稳定 Item 身份、幂等重放、依赖顺序、owner 授权、游标事务和真正冲突显式处理。

## 工程决定

- 普通 REST 创建由服务器生成 UUID；`/sync/push` 用已有客户端 UUID 写同一 canonical 表。认证 token 确定 owner，忽略本地记录内的旧 `owner_id`。父 Course/RawCapture 先于 Item，Item/CourseInformation 先于 RawCaptureOutput。
- Dexie v3 为 outbox 增加持久本地顺序；v2 升级保留旧 mutation。本地事务同时 ACK 和写入服务器版本；pull 同时写实体与 opaque cursor。失败时不推进 cursor。
- 首次同步把匿名本地 owner 绑定到已认证 owner；已绑定数据库拒绝另一账号，避免混合两人的记录。账号切换与数据迁移仍需要单独流程。
- Item 的同字段变更由服务器记录 SyncConflict；worker 停止当前队列并保留未 ACK mutation。当前 UI 尚未提供冲突解决界面。
- 本地删除 token 随同步删除 mutation 发送，服务器只保存哈希并执行独立的限时 Undo。若服务器已确认删除，随后客户端长期离线直至 Undo token 过期，服务器会拒绝 Undo；本地错误保留，需在后续冲突/恢复流程处理。

## 当前边界

已用 PGlite + fake IndexedDB 测试本地记录、重启、按序推送、owner 绑定、服务端同 UUID 存储、拉取、跨设备编辑及同字段冲突。浏览器侧使用 [Supabase Auth 会话](https://supabase.com/docs/reference/javascript/auth-getsession)在有配置且已登录时触发 worker；[邮件登录链接](https://supabase.com/docs/reference/javascript/auth-signinwithotp)能力已封装，但账号入口尚未确定。真实 PostgreSQL、真实 Supabase 会话、后台调度与冲突 UI 尚未验收。暂未接通的实体 mutation 必须留在 outbox，不能被静默 ACK 或丢弃。
