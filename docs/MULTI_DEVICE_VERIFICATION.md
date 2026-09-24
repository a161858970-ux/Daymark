# Multi-device Sync Verification

**执行日期**：2026-09-24

**自动化环境**：两个独立的 fake IndexedDB/Dexie 数据库作为 Device A 与 Device B；Fastify 使用真实路由和认证 owner；两端共享一套 PGlite PostgreSQL schema。每个 worker 都走正式 outbox → `/sync/push` → change log → `/sync/changes` → Dexie pull 路径。

这里的 PASS 是可重复的本机协议集成结果。真实 Supabase Auth、外部 PostgreSQL 和两台物理设备仍单独标为 BLOCKED，不能由 PGlite 结果替代。

## A. Device A 离线创建 Item，再由 Device B 拉取

- **Initial state**：服务端、A、B 都没有目标 RawCapture/Item；A 不运行 sync worker。
- **Operation sequence**：A Quick Capture 并本地形成 Item → 验证 B 仍为空 → A reconnect 并 push → B pull。
- **Expected state**：离线期间原文和 Item 留在 A；连接后服务端和 B 获得同一个 canonical Item ID。
- **Actual state**：B 在 A push 前为空；A push 后 B 拉到与 A 相同的 Item ID；worker 未停止。
- **Result**：**PASS**。
- **Evidence**：`apps/api/src/db/multi-device.test.ts` — `A-G: two devices converge through create, merge, conflict, resolution, delete competition, and expired Undo`。

## B. 两设备修改不同字段

- **Initial state**：A、B 都持有同一 Item revision。
- **Operation sequence**：A 修改 `title`；B 修改 `detail`；A push；B push；A pull。
- **Expected state**：服务端进行非重叠字段合并，不要求用户处理冲突；两端同时保留 A 标题与 B 详情。
- **Actual state**：两次 push 均 ACK；A、B 最终对象同时包含 `A 的标题` 与 `B 的补充`。
- **Result**：**PASS**。
- **Evidence**：同一 A–G 测试。

## C. 两设备修改同一字段

- **Initial state**：A、B 已在同一 merged revision。
- **Operation sequence**：A 与 B 分别修改 `title`；A 先 push；B 后 push。
- **Expected state**：B 的 stale 同字段写入不能覆盖 A；形成只包含 `title` 的开放冲突，B mutation 留在 outbox。
- **Actual state**：B worker 以 `VERSION_CONFLICT` 停止；服务端 conflict 的 `conflicting_fields` 只有 `title`。
- **Result**：**PASS**。
- **Evidence**：同一 A–G 测试。

## D. 冲突解决后两端收敛

- **Initial state**：场景 C 的 `title` 冲突开放，B 本机值尚未 ACK。
- **Operation sequence**：用户选择 B 的 LOCAL 标题 → B 接受 resolution → A、B 正常 pull/push。
- **Expected state**：原冲突 mutation 被明确结束；服务器产生正常 revision；两端标题一致。
- **Actual state**：A、B 标题都变为 `B 再次修改`，outbox 可继续运行。
- **Result**：**PASS**。
- **Evidence**：同一 A–G 测试。

## E. 解决后立即产生下一条本机编辑

- **Initial state**：场景 D 已解决，B 知道 resolution 的服务器版本。
- **Operation sequence**：B 立即修改 `detail` → B push → A pull。
- **Expected state**：新 mutation 使用解决后的 base version，不被旧冲突的 ACK/结果吞掉。
- **Actual state**：B push ACK，A 拉到 `解决后立即补充`。
- **Result**：**PASS**。
- **Evidence**：同一 A–G 测试；另有 `packages/storage/src/sync.test.ts` — `acknowledges a resolved conflict while preserving a later local edit`。

## F. delete vs edit

- **Initial state**：两端 Item 均未删除。
- **Operation sequence**：B 离线修改标题；A 删除并先 push；B 再 push；用户在冲突中选择已同步删除。
- **Expected state**：B 的编辑不能复活 tombstone；形成显式冲突；冲突接口禁止以本机字段绕过删除；两端最终保持删除。
- **Actual state**：B 得到 `VERSION_CONFLICT`，current entity 有 `deleted_at`；选择 REMOTE 后 A、B 都保留 tombstone。
- **Result**：**PASS**。
- **Evidence**：同一 A–G 测试；Web 测试 `does not offer a local overwrite for an already deleted object`。

## G. expired Undo

- **Initial state**：服务端 Item 已删除并保存 token-bound Undo；测试把 token expiry 推进到过去。
- **Operation sequence**：A 在本地执行 Undo → push 被永久拒绝 → ACTION_REQUIRED 显示不可安全重试 → 用户明确“采用已同步状态” → 重置 cursor 并 pull。
- **Expected state**：不得静默 undelete；不得丢掉修复 provenance；最终跟随服务端 tombstone。
- **Actual state**：issue 为 `FORBIDDEN`、`can_retry=false`、`can_abandon=true`；放弃记录写入 repair decision；pull 后本地仍删除。
- **Result**：**PASS**。
- **Evidence**：同一 A–G 测试；`packages/storage/src/sync.test.ts` — `abandons an expired Undo only by accepting synced state and preserving repair provenance`。

## H. CourseSchedule 整组替换冲突

- **Initial state**：A 创建 Course 并同步给 B；两端 collection version 都是 0、课程安排为空。
- **Operation sequence**：A 设置星期二一条课表；B 离线设置星期四一条课表；A push 整组 → B push stale 整组 → 用户选择 B 的 LOCAL 整组 → 两端 pull。
- **Expected state**：一条本地 outbox command、一个服务端事务、一个 envelope；不得把星期二和星期四拼成两条；保留选中组的客户端 ID。
- **Actual state**：B 得到只含 `collection` 的冲突；解决后 A、B 和服务端活动行都只有 B 的 canonical schedule ID；A 组成员成为 tombstone。
- **Result**：**PASS**。
- **Evidence**：`apps/api/src/db/multi-device.test.ts` — `H: two devices resolve a whole CourseSchedule replacement without partial rows`；`apps/api/src/db/collection-sync.test.ts` 提供 replay/owner/version 细节证据。

## I. SemesterWeek 整组替换冲突

- **Initial state**：A 创建 Semester 并同步给 B；周映射为空、collection version 为 0。
- **Operation sequence**：A 与 B 离线建立不同的第 1 周区间；A 先 push；B push stale 整组；用户选择 REMOTE；两端 pull。
- **Expected state**：不得出现重叠/重复的两条第 1 周；整组选择后两端使用 A 的 canonical week ID。
- **Actual state**：B 得到 `collection` 冲突；选择 REMOTE 后 A、B、服务端均只有 A 的一条周映射。
- **Result**：**PASS**。
- **Evidence**：`apps/api/src/db/multi-device.test.ts` — `I: two devices resolve a SemesterWeek replacement as one collection`；`apps/api/src/db/collection-sync.test.ts` 验证单 envelope。

## J. pull 期间出现重叠本机 mutation

- **Initial state**：本地 Item 已同步；服务端待拉页修改 `detail`；拉取页提交前本地产生 `title` mutation。
- **Operation sequence**：尝试应用远端页 → 检测 entity overlap → 整页拒绝 → 本机 mutation push/ACK → 重新拉取含远端和本机 revision 的页。
- **Expected state**：第一次不能推进 cursor 或部分应用远端字段；重试后两字段都保留。
- **Actual state**：第一次抛出 overlap，cursor 仍为 null、detail 未改变；ACK 后重新应用，title/detail 都存在且 cursor 前进。
- **Result**：**PASS**。
- **Evidence**：`packages/storage/src/sync.test.ts` — `keeps the pull cursor when a new local edit overlaps a remote page`。

## K. 服务端 commit 后响应丢失

- **Initial state**：本地有未同步 RawCapture + Item；传输层只在第一次服务器成功提交后丢弃响应。
- **Operation sequence**：第一次 push commit 后抛网络错误 → outbox 保留原 mutation → worker 重试相同 ID → 服务端返回保存的幂等结果。
- **Expected state**：mutation ID 不变；实体和 revision 不重复。
- **Actual state**：两次发送的 mutation ID 相同；worker 第二次完成；服务器 `raw_captures` 与 `items` 各只有 1 行。
- **Result**：**PASS**。
- **Evidence**：`apps/api/src/db/multi-device.test.ts` — `K: a committed mutation with a lost response retries the same ID without duplicates`。

## `T-SYNC-005–008`. 正式 acceptance 语义

- **Initial state**：每个子场景都由 Device A 创建一个 Item，push 后由 Device B pull；两端持有同一 canonical ID/revision。
- **Operation sequence**：依次执行两端并发 complete、两端不同 `due_at`、A 改 `due_at` + B 改 `detail`、A 删除 + B pull。
- **Expected state**：并发 complete 无冲突且收敛 COMPLETE；不同 due date 只形成 `due_at` conflict；非重叠字段自动合并；删除 tombstone 传播且普通 list 隐藏对象。
- **Actual state**：complete 场景两端均为 COMPLETE 且 conflict list 为空；due 场景 worker 以 `VERSION_CONFLICT` 停止且 `conflicting_fields = ["due_at"]`；安全合并后两端同时保留新时间和补充说明；删除后 B 保存 `deleted_at` 且普通 list 不含该 ID。
- **Result**：**PASS**。
- **Evidence**：`apps/api/src/db/multi-device.test.ts` — `T-SYNC-005..008 covers concurrent complete, due conflict, safe merge, and tombstone propagation`。

## 汇总

- **Automated simulated infrastructure**：A–K 与正式 `T-SYNC-005–008` 全部 **PASS**。
- **Real PostgreSQL**：**BLOCKED — EXTERNAL CONFIGURATION REQUIRED**。当前没有 `REAL_DATABASE_URL`，也未发现本机 `docker`/`psql`。
- **Real Supabase Auth/API**：**BLOCKED — EXTERNAL CONFIGURATION REQUIRED**。当前没有 Supabase URL、可登录账号或 access token。
- **Two physical devices / installed Windows-Mobile shells**：**NOT RUN**。已有可重复的双 Dexie 协议测试流程，但它不等于物理设备、后台网络与平台生命周期验收。
