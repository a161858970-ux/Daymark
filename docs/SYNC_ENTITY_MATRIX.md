# Sync Entity Matrix

**复核日期**：2026-09-24

**依据**：`03_DOMAIN_MODEL.md`、`15_DATABASE_SCHEMA.md`、`16_API_CONTRACT.md`、`17_SYNC_NOTIFICATION_ENGINEERING.md` 与当前代码。

标记说明：`✅` 表示当前链路已实现；`N/A` 表示规格未定义该操作或对象是不可变记录；`⛔` 表示规格要求但当前尚未实现。这里的“已实现”表示本地、API/PGlite 或协议代码存在，不代表真实 Supabase/PostgreSQL 已验收。

| Entity                                | CREATE                              | READ / PULL                       | UPDATE                             | DELETE                           | OUTBOX                                         | IDEMPOTENCY                  | OWNER SCOPE                       | VERSION / CONCURRENCY                              | TOMBSTONE                 | CONFLICT                                                    |
| ------------------------------------- | ----------------------------------- | --------------------------------- | ---------------------------------- | -------------------------------- | ---------------------------------------------- | ---------------------------- | --------------------------------- | -------------------------------------------------- | ------------------------- | ----------------------------------------------------------- |
| Semester                              | ✅ 本地、REST、sync                 | ✅ REST + pull                    | ✅ PATCH + sync                    | N/A，正式 API 未定义删除         | ✅                                             | ✅ mutation / REST key       | ✅ token owner                    | ✅ row version；非重叠字段合并                     | schema 预留，当前无删除流 | ✅ 同字段冲突                                               |
| SemesterWeek                          | ✅ 作为整组成员                     | ✅ GET + collection envelope pull | ✅ 整组 `PUT` / collection command | ✅ 从整组移除                    | ✅ 每次替换仅一条 `SEMESTER_WEEK_COLLECTION`   | ✅ command ID                | ✅ 由 Semester parent 校验        | ✅ collection version + 替换前快照 hash            | N/A，整组表按事务重写     | ✅ 整组冲突，只能整组选择                                   |
| Course                                | ✅ 本地、REST、sync                 | ✅ REST + pull                    | ✅ PATCH + sync                    | ✅ delete-with-strategy 原子命令 | ✅                                             | ✅                           | ✅                                | ✅ row version；更新可非重叠合并；删除要求预期版本 | ✅ `deleted_at`           | ✅ 同字段冲突；删除竞争显式拒绝/修复                        |
| CourseSchedule                        | ✅ 作为整组成员                     | ✅ GET + collection envelope pull | ✅ 整组 `PUT` / collection command | ✅ 从整组移除                    | ✅ 每次替换仅一条 `COURSE_SCHEDULE_COLLECTION` | ✅ command ID                | ✅ 由 Course parent 校验          | ✅ collection version + 替换前快照 hash            | ✅ 被替换成员保留软删除   | ✅ 整组冲突，只能整组选择                                   |
| CourseInformation                     | ✅ 本地、REST、sync                 | ✅ REST + pull                    | ✅ PATCH + sync                    | ✅ REST + sync                   | ✅                                             | ✅                           | ✅                                | ✅ row version、非重叠字段合并                     | ✅                        | ✅ 同字段冲突                                               |
| Item                                  | ✅ 本地、REST、sync                 | ✅ REST/Overview/Calendar + pull  | ✅ 编辑、完成、恢复、提醒等级      | ✅ 删除 + token-bound Undo       | ✅                                             | ✅                           | ✅                                | ✅ row version、非重叠字段合并、stale guard        | ✅                        | ✅ 同字段、delete-vs-edit；已删除对象不能由冲突接口任意恢复 |
| RawCapture                            | ✅ capture-first 本地、REST、sync   | ✅ unresolved/read + pull         | ✅ processing / unresolved 状态    | ✅ 仅 unresolved 可删除          | ✅                                             | ✅                           | ✅                                | ✅ row version                                     | ✅                        | ✅ 状态字段冲突                                             |
| RawCaptureOutput                      | ✅ append-only                      | ✅ provenance read + pull         | N/A，不可变                        | N/A，不可变                      | ✅ create                                      | ✅                           | ✅ capture 与目标对象均校验 owner | N/A，创建后不可变                                  | N/A；非法 provenance 拒绝 |
| RawCaptureDecision                    | ✅ append-only                      | ✅ decision read + pull           | N/A，不可变                        | N/A，不可变                      | ✅ create                                      | ✅                           | ✅ RawCapture owner               | N/A，创建后不可变                                  | N/A                       |
| ItemAssociation                       | ✅ 本地、REST、sync；canonical pair | ✅ 双向查询 + pull                | N/A，关联不可变                    | ✅ REST + sync                   | ✅                                             | ✅                           | ✅ 两端 Item owner                | ✅ row version；重复 pair 唯一约束                 | ✅                        | N/A；stale delete 明确拒绝，不传播 Item 状态                |
| Reminder 本地派生计划                 | ✅ 由 Item + policy 生成            | ✅ Dexie 重启恢复                 | ✅ Item 时间/状态变化时重算        | ✅ stale/完成/删除时取消         | N/A，设备派生状态不上传                        | ✅ stable logical key 去重   | ✅ 当前本地 owner 数据域          | ✅ snapshot stale guard                            | N/A                       | N/A                                                         |
| Reminder 云端 delivery / device lease | ⛔ schema 存在，服务未接入          | ⛔                                | ⛔ claim/ack 未接入                | ⛔                               | N/A，不是普通业务实体 outbox                   | ⛔ delivery/claim 幂等待实现 | ⛔ API 待实现                     | ⛔ lease 并发待实现                                | N/A                       | N/A                                                         |

## 集合命令边界

- `SemesterWeek` 与 `CourseSchedule` 的用户写入不再产生逐成员 outbox；本地事务保存最终集合并写一条父对象级 command。
- command 带稳定 `mutation_id`、父对象 ID、`base_version`、`previous_collection` 和目标 `collection`。成员继续使用客户端生成的 canonical UUID。
- 服务端锁定 owner-scoped parent 和 collection revision，在一个 PostgreSQL 事务内比较版本及替换前快照、应用全部成员、更新 revision、写一个 change-log envelope 和幂等结果。
- pull 端在一个 Dexie 事务内应用 envelope 与游标。无效成员会回滚整页，不会留下半组数据。
- 并发替换产生 `collection` 单字段冲突。UI 只显示两组记录数量，用户选择整组本机或整组已同步内容，不混合成员。
- 服务端仍识别旧开发版本已产生的逐成员 mutation，以免直接丢弃尚未发送的本地操作；当前版本所有新写入都走 collection command。发布前仍需用真实旧浏览器数据做一次升级演练。

## 自动证据

- `apps/api/src/db/collection-sync.test.ts`：集合幂等、owner scope、stale 版本、整组冲突、canonical ID、ItemAssociation、Semester/Course 字段并发。
- `apps/api/src/db/multi-device.test.ts`：两个独立 Dexie 数据库经 Fastify + PGlite 完成 A–I/K 场景。
- `packages/storage/src/sync.test.ts`：pull 事务/游标、ACTION_REQUIRED、安全放弃、集合 envelope 原子应用、解决后后续 mutation 保留。
- `apps/api/src/db/resource-coverage.test.ts`：Course、CourseInformation、RawCapture 与 ItemAssociation 的正式 REST 路径。

## 当前缺口

真实 PostgreSQL/Supabase 尚无凭据可运行；Reminder 云端 delivery/lease API、设备通知平台与 R-01 生产数值仍是独立发布阻塞项。它们没有被当前 Phase 6 的模拟结果冒充为已验证。
