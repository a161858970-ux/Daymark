# ADR-003 — 首条本地到服务端同步链路

**状态**：Accepted；本地协议实现完成，真实账号/外部数据库验收待完成。更新于 2026-09-24。

## 依据

`08_SYNC_OFFLINE_SPEC.md`、`15_DATABASE_SCHEMA.md`、`16_API_CONTRACT.md`、`17_SYNC_NOTIFICATION_ENGINEERING.md` 和 `21_SPEC_AUDIT.md` 要求本地先保存、稳定 Item 身份、幂等重放、依赖顺序、owner 授权、游标事务和真正冲突显式处理。

## 工程决定

- 普通 REST 创建由服务器生成 UUID；`/sync/push` 用已有客户端 UUID 写同一 canonical 表。认证 token 确定 owner，忽略本地记录内的旧 `owner_id`。父 Course/RawCapture 先于 Item，Item/CourseInformation 先于 RawCaptureOutput。
- Dexie v3 为 outbox 增加持久本地顺序；v2 升级保留旧 mutation。本地事务同时 ACK 和写入服务器版本；pull 同时写实体与 opaque cursor。失败时不推进 cursor。
- 首次同步把匿名本地 owner 绑定到已认证 owner；已绑定数据库拒绝另一账号，避免混合两人的记录。账号切换与数据迁移仍需要单独流程。
- Semester、Course、Item、CourseInformation、RawCapture 的同字段变更由服务器记录 SyncConflict；worker 停止当前队列并保留未 ACK mutation。Conflict UI 支持本机、已同步或显式值，已删除对象不能由该入口任意恢复。
- 本地删除 token 随同步删除 mutation 发送，服务器只保存哈希并执行独立的限时 Undo。服务器拒绝过期 Undo 后，mutation 进入 ACTION_REQUIRED；用户只能明确采用已同步 tombstone，repair provenance 会保留。
- SemesterWeek/CourseSchedule 的整组替换使用父对象级 collection command；具体版本、事务、envelope 与冲突决定见 `ADR-005-collection-replacement-sync.md`。

## 当前边界

已用 PGlite + 两个独立 fake IndexedDB 测试本地记录、重启、按序推送、owner 绑定、服务端同 UUID、pull、字段/整组冲突、ACTION_REQUIRED、丢失响应重试和 A–K 场景。浏览器已有 Supabase 邮件登录入口和会话监听。真实 PostgreSQL、真实 Supabase 会话、物理设备网络生命周期与旧 IndexedDB collection outbox 升级仍未验收；入口见 `REAL_POSTGRES_VERIFICATION.md`。
