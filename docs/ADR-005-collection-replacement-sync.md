# ADR-005 — Collection replacement sync

**状态**：Accepted，2026-09-24

**范围**：SemesterWeek 与 CourseSchedule 的整组替换。

## Context

正式 API 把学期周映射和课程安排都定义为 atomic replace。逐成员 `CREATE`/`DELETE` outbox 无法表达“这一组是同一个用户决定”，会带来四个错误语义：同步中间状态可见、断线后只应用半组、并发替换互相拼接、单行版本无法判断整组是否 stale。

## Decision

### 1. 父对象级 sync target

同步基础设施增加两个 command/envelope 类型：

- `SEMESTER_WEEK_COLLECTION`，identity 是 `semester_id`；
- `COURSE_SCHEDULE_COLLECTION`，identity 是 `course_id`。

它们只是同步协议 target，不新增产品领域实体；领域仍是 SemesterWeek 与 CourseSchedule。

### 2. 一次本地替换对应一条 outbox command

本地保存与 outbox 写入在同一 Dexie 事务完成。command 包含：

- 客户端生成的稳定 `mutation_id`；
- parent ID；
- 已知 `base_version`，从未同步时为 `0`；
- `previous_collection`；
- 目标 `collection`；
- 每个成员原有的客户端 canonical UUID。

同一 command 重试复用原 `mutation_id`。修复 ACTION_REQUIRED 时才产生新的 mutation ID，并记录旧、新 mutation 的 provenance。

### 3. collection revision 与双重 stale guard

PostgreSQL 使用 `sync_collection_revisions(owner_id, collection_type, parent_id)` 保存 collection version 和 canonical snapshot hash。服务端同时比较：

1. `base_version` 是否等于当前 collection version；
2. `previous_collection` 的规范化 hash 是否等于当前整组快照。

任何一项不一致都形成整组 conflict，不能静默覆盖或把两端成员拼接。

### 4. 一个服务端事务、一个 change-log envelope

服务端在一个事务内：

1. 验证 token owner 对 parent 的权限并锁定 parent/revision；
2. 校验全部成员、parent ID、日期/时间边界与重复 ID；
3. 应用整组替换；
4. 更新 collection revision；
5. 写一个包含完整目标集合的 change-log envelope；
6. 写入 command 的幂等响应。

事务提交前没有任何成员对其他请求可见。失败时全部回滚。

### 5. pull 原子应用

客户端把 envelope、collection version 和 pull cursor 放在同一 Dexie 事务。SemesterWeek 整表替换；CourseSchedule 将移除成员保留为 tombstone，并写入 envelope 中的活动集合。如果成员结构或 parent 不一致，整页回滚，cursor 保持原值。

### 6. 冲突按整组解决

collection conflict 的唯一冲突字段是 `collection`。用户只能选择完整本机组或完整已同步组。当前产品不提供成员级合并，因为那会重新引入未经用户确认的组合结果。选择本机组会产生新 collection revision 和 envelope；选择已同步组保持现有 revision。两种选择都通过普通 pull 收敛。

### 7. 普通 REST 与 sync 共用 revision stream

`PUT /semesters/{id}/weeks` 与 `PUT /courses/{id}/schedules` 仍是正式人工/导入接口。它们在相同数据库事务中更新 collection revision 并写完整 envelope，因此不会绕过离线客户端的并发检测。

## Consequences

- Offline replace、重试和并发替换具有与正式 REST 一致的原子语义。
- change log 的可见单位是整组，客户端不会观察到中间行集合。
- 冲突界面只需显示父对象和两组数量，不暴露 SQL、版本号或 outbox 数据。
- `sync_collection_revisions` 是新增迁移 `002_collection_sync.sql` 的持久状态。
- 旧开发版本已产生的逐成员 mutation 仍由服务端兼容读取，避免静默丢弃；新代码不再生成它们。发布前需对真实旧 IndexedDB 做升级演练。

## Verification

- PGlite：幂等 replay、stale version、替换前快照、owner isolation、整组冲突及两种解决策略。
- fake IndexedDB：单 command outbox、atomic envelope、无效 envelope rollback、解决后保留更晚的本机替换。
- 双设备模拟：两个独立 Dexie 数据库经 Fastify + PGlite 并发替换并最终收敛。
- 真实 PostgreSQL：测试入口已建立，当前因缺少 `REAL_DATABASE_URL` 尚未执行。
