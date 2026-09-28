# Final Release Validation Runbook

**用途**：Release 之后的真实环境验收跑道（可执行步骤 + 记录表）。
**性质**：这是“可执行”，不是“已验证”。未真实执行的条目一律标记 `NOT RUN — PHYSICAL` 或 `BLOCKED — EXTERNAL CONFIGURATION`，不得因为本文存在而写成 verified。

## 0. 状态词汇（唯一允许的五种）

| 标记                               | 含义                                      |
| ---------------------------------- | ----------------------------------------- |
| `VERIFIED REAL`                    | 在真实外部系统/真实网络上执行并留有证据   |
| `VERIFIED SIMULATED`               | 在 PGlite / 双 Dexie 等模拟基础设施上执行 |
| `VERIFIED LOCAL`                   | 本机自动测试或本机浏览器人工核对          |
| `BLOCKED — EXTERNAL CONFIGURATION` | 缺少外部凭据/环境，无法执行               |
| `NOT RUN — PHYSICAL`               | 需要物理设备或辅助技术，尚未执行          |

记录表列：`Initial state | Operation | Expected | Actual | Result | Evidence`。
`Evidence` 必须是可复查的东西：终端输出、HTTP 状态、截图、导出的 JSON、设备照片。

---

## A. Real PostgreSQL

**实际执行库**：Supabase 真实 PostgreSQL（`aws-0-…pooler.supabase.com:5432`）—— 迁移与本段验收均在其上执行，未使用本地可丢弃库。

**前置**

```bash
# 可丢弃数据库（任选其一：本机 PostgreSQL / docker run postgres:16）
createdb course_manager_release
# 仓库根 .env 或 shell：
DATABASE_URL=postgres://<user>:<pass>@127.0.0.1:5432/course_manager_release
REAL_DATABASE_URL=postgres://<user>:<pass>@127.0.0.1:5432/course_manager_release
```

| #   | Initial state | Operation                                                             | Expected                                                                                                           | Actual                                                                                                                                                           | Result                                                                    | Evidence                                         |
| --- | ------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------ |
| A1  | 空数据库      | `pnpm db:migrate`                                                     | 依次应用 `001_initial` `002_collection_sync` `003_course_import` `004_reminder_delivery`；`schema_migrations` 4 行 | `schema_migrations` = **4 行**：`001_initial` `002_collection_sync` `003_course_import` `004_reminder_delivery`（applied_at 2026-09-27T08:52Z；2026-09-28 复核） | `VERIFIED REAL` 2026-09-27                                                | 迁移终端输出 + `SELECT * FROM schema_migrations` |
| A2  | 迁移完成      | `pnpm test:postgres`                                                  | `real-postgres.integration.test` 不再 skip，全绿                                                                   | `real-postgres.integration.test` → **`Tests 1 passed (1)` 且未 skip**（2026-09-28，需 `REAL_DATABASE_URL`）                                                      | `VERIFIED REAL` 2026-09-28                                                | 测试终端输出（无 skipped）                       |
| A3  | 迁移完成      | `ALLOW_DEVELOPMENT_SEED=1 pnpm db:seed`（仅本地可丢弃库）             | seed 成功；不设开关时 seed 必须拒绝                                                                                | 无开关运行 `node dist/db/seed.js` → 立即抛 `Set ALLOW_DEVELOPMENT_SEED=1 ...`（exit 1、未连库）✓；正向 seed 未在真实库执行（会写入演示数据，需可丢弃库）         | `VERIFIED REAL`（负向守卫）；正向 seed `BLOCKED — EXTERNAL CONFIGURATION` | seed 输出 + 无开关时的报错                       |
| A4  | 迁移完成      | `pnpm verify:live-api`（配 `API_BASE_URL` + `SUPABASE_ACCESS_TOKEN`） | 受保护接口返回数据而非 401                                                                                         | `Live API verified for owner 4a8068f2-65fa-4e99-b995-bc4dd0b783ed; change page size 0`（2026-09-28 复跑，临时 JWT 账号验证后已删除）                             | `VERIFIED REAL` 2026-09-28                                                | 脚本输出                                         |

---

## B. Supabase（认证 + 真实 API）

**前置**：Supabase 项目；根 `.env`：

```
SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<anon/publishable key>
SUPABASE_ACCESS_TOKEN=<访问令牌，用于只读 live smoke>
```

| #   | Initial state | Operation                                         | Expected                                                  | Actual                                                                                                               | Result                                                                   | Evidence                                     |
| --- | ------------- | ------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------- |
| B1  | 无配置        | 写入上述变量并 `pnpm dev`                         | API 注册认证业务路由（不再只有 health）；前端出现登录入口 | `/health` 200；5 个受保护路由返回 `401 AUTH_REQUIRED`（非 404）；登录面板出现                                        | `VERIFIED REAL` 2026-09-27                                               | curl 探测 + 登录面板截图                     |
| B2  | 未登录        | 浏览器登录（Auth v1）                             | 得到 session，owner 为 `auth.users.id`                    | **邮箱+密码**与**邮箱验证码**均已真实登录（owner `645027f0-…`，退出重登后 owner 不变）；手机号验证码 / Google 未配置 | `VERIFIED REAL`（邮箱两种方式）；其余 `BLOCKED — EXTERNAL CONFIGURATION` | 登录截图 + `docs/AUTH_REAL_VALIDATION.md §6` |
| B3  | 已登录        | 本地快速记录 → 观察同步                           | outbox 推送 → 服务端入库 → pull 收敛                      | 2 条记录入库：`items` 2 行、`change_log`（RAW_CAPTURE 6 / ITEM 2 / DECISION 2 / OUTPUT 2）、`devices` 2              | `VERIFIED REAL` 2026-09-27                                               | 服务端查询结果 + 两端截图                    |
| B4  | 已登录        | `SUPABASE_ACCESS_TOKEN` 下 `pnpm verify:live-api` | 通过                                                      | `Live API verified for owner d54867cf-…; change page size 0`                                                         | `VERIFIED REAL` 2026-09-27                                               | 脚本输出                                     |
| B5  | 已登录        | 401/403 路径（无效 token 调用受保护接口）         | 稳定错误码 `AUTH_REQUIRED`，产品文案，无内部细节          | 伪造 Bearer → `401 AUTH_REQUIRED`，无内部细节泄漏                                                                    | `VERIFIED REAL` 2026-09-27                                               | 响应体                                       |

---

## C. 两个独立 browser profile（不是两个 tab）

**为什么必须独立 profile**：IndexedDB 是按 origin + profile 存的，同一 profile 的两个 tab 共用同一个 `course-manager` 数据库，会把“双设备”测成“同设备”。

```bash
# profile A
start chrome --user-data-dir=%LOCALAPPDATA%\cm-profile-a --app=http://127.0.0.1:5173
# profile B
start msedge --user-data-dir=%LOCALAPPDATA%\cm-profile-b --app=http://127.0.0.1:5173
```

**独立性检查**：在 A 打开 DevTools → Application → IndexedDB → `course-manager`；在 B 中该库必须为空/不存在，然后各登录不同或相同的 owner（按验收设计）。

| #   | Initial state            | Operation                          | Expected                                         | Actual                                                                                                                                                                                                                                                                                                                                           | Result                     | Evidence                                                                                                       |
| --- | ------------------------ | ---------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- | -------------------------------------------------------------------------------------------------------------- |
| C1  | A 已有数据               | A 离线（DevTools offline）快速记录 | `✓ 已记录`，A 本地可见                           | 离线记录「离线测试不要丢」成功、界面显示当前离线                                                                                                                                                                                                                                                                                                 | `VERIFIED REAL` 2026-09-27 | 用户执行 + 服务端 `items` 行                                                                                   |
| C2  | A 离线已记录             | 刷新 A                             | 记录仍在（重启/刷新不丢）                        | 离线状态下刷新后记录仍在（用户确认通过）                                                                                                                                                                                                                                                                                                         | `VERIFIED REAL` 2026-09-27 | 用户执行报告                                                                                                   |
| C3  | A 恢复网络               | 观察 A 自动同步                    | outbox 自动推送，无需手动                        | 本地 09:51:35 创建 → 服务端 09:52:34 ITEM CREATE，未点任何按钮；`raw_captures` 3/3 RESOLVED，无卡死                                                                                                                                                                                                                                              | `VERIFIED REAL` 2026-09-27 | `items`/`change_log` 时间戳                                                                                    |
| C4  | A 已同步                 | B 拉取                             | B 看到同一条记录                                 | InPrivate 窗口见「明天买东西」；B 新建「9.30测试第二台设备」后 A 也可见（双向）                                                                                                                                                                                                                                                                  | `VERIFIED REAL` 2026-09-27 | 两端截图 + `devices`=2                                                                                         |
| C5  | A、B 同条目              | 非重叠字段分别编辑                 | 自动合并，无冲突提示                             | 首跑出现假冲突（表单旧值 + 整条快照），修 `b41b16e`、`5dce809` 后复测：**两端均不弹框**，终值 = A 标题 + B 日期；该时段 `sync_conflicts` 无新增                                                                                                                                                                                                  | `VERIFIED REAL` 2026-09-27 | 服务端 `change_log` 与冲突表                                                                                   |
| C6  | A、B 同条目              | 同字段分别编辑（标题）             | 显式冲突，只列该字段                             | 两端离线各改标题 → 恢复后冲突 `61b93103`：`conflicting_fields=["title"]`、客户端 payload 仅 `title`                                                                                                                                                                                                                                              | `VERIFIED REAL` 2026-09-27 | 冲突记录 + 用户确认                                                                                            |
| C7  | 冲突可见                 | 选择本机/已同步/显式值并解决       | 收敛到所选值，写入 revision                      | 选「本机值」→ `USE_LOCAL` 写入、v17 落库、**两端一致**；三种策略均已真实走过：EXPLICIT `ffb6c3eb`、REMOTE `5a8b1438`/`20c08c62`、LOCAL `61b93103`                                                                                                                                                                                                | `VERIFIED REAL` 2026-09-27 | resolution 记录 + 用户确认                                                                                     |
| C8  | 解决后                   | 立即再编辑一次                     | 后续编辑不被旧 resolution 覆盖                   | resolution 于 `00:42:16.772` 写入 `C8-A`（v19），14 秒后的第二次编辑落库为 `C8-第二次编辑`（v20），其后无回退                                                                                                                                                                                                                                    | `VERIFIED REAL` 2026-09-28 | `change_log` v18→v20 + 冲突 `89525897`                                                                         |
| C9  | A 删除、B 编辑同条目     | 观察结果                           | 不静默复活；保留删除或进入显式处理               | B 的标题先入库 → A 的删除被拒 → 冲突 `760e5b04` **只列 `deleted_at`**（标题不在冲突里）→ 显式选择保留删除 → v3 `DELETE`、两端消失；`change_log` 删除后无任何 UPDATE、无 `deleted_at:null` 复活                                                                                                                                                   | `VERIFIED REAL` 2026-09-28 | 冲突记录 + `change_log` + 用户确认                                                                             |
| C10 | 已删除条目               | 限时 Undo 过期后再尝试 undo-delete | 拒绝 undelete，只能采用已同步 tombstone          | 真实 API 对照：窗口内撤销 **200**（`consumed_at` 写入）；过期后撤销 **403 `FORBIDDEN`「Delete Undo has expired」**，`GET` 该条 404、DB `deleted_at` 仍在且 token 未消费。UI 只在 10 s 内有撤销入口，过期场景由 API 层真实验证                                                                                                                    | `VERIFIED REAL` 2026-09-28 | API 响应 + `delete_undo_tokens` 行                                                                             |
| C11 | A、B 各改 CourseSchedule | 并发整组替换                       | 整组冲突：只能选完整本机组或完整已同步组         | 冲突 `5763af3f`：`conflicting_fields=["collection"]` → 选 `USE_REMOTE` → **活的课表行恰好 1 行**（无缝合）、`sync_collection_revisions` 该课 `collection_version=8`；面板已按 `17 §9` 列出两组逐条明细                                                                                                                                           | `VERIFIED REAL` 2026-09-28 | 冲突记录 + `course_schedules` + revision 行                                                                    |
| C12 | A、B 各改 SemesterWeek   | 并发整组替换                       | 同 C11                                           | 冲突 `57f2b1a0`：`conflicting_fields=["collection"]` → 选 `USE_LOCAL`（17 秒内解决） → 最终 **15 周连续无缝**（第1周 09-07～09-13 … 第15周 12-14～12-20），无两组缝合；`sync_collection_revisions` SEMESTER_WEEK `collection_version=53`；面板含推算徽标与逐条明细                                                                               | `VERIFIED REAL` 2026-09-28 | 冲突记录 + `semester_weeks` + revision 行                                                                      |
| C13 | 双端有未决状态           | 关闭并重开两个 profile             | outbox 继续推送，unresolved 记录复现，无重复对象 | A 离线新建 `C13重启测试`（本地 06:07:31）→ 关窗重开后 06:08:16 服务端 CREATE，outbox 跨重启继续推送；B 离线改标题 → 本地即时生效 → 重连 `06:34:01 UPDATE {"title":"C13-B改"} v2`；普通窗口下"保存→立即关窗→重开"本地写保留；items 5 条标题无重复、无重复对象                                                                                     | `VERIFIED REAL` 2026-09-28 | `items`/`change_log` 行 + 两端截图（**持久化验收必须用普通窗口：无痕窗口关窗即清空，属浏览器行为非产品缺陷**） |
| C14 | 网络抖动环境             | 长时间重试（断续网络 ≥30 分钟）    | 无重复条目、无卡死、ACTION_REQUIRED 有用户出口   | 断续网络 07:07–07:39 UTC 共 **31.5 分钟**、多轮断/连：20 条 `change_log` 全部落库（CREATE/UPDATE/DELETE/RawCapture 全链路）、`DUPLICATE_TITLES=[]`、`UNRESOLVED_CONFLICTS=0`；期间出现的 ACTION_REQUIRED 由用户自行解决冲突字段（有出口、可继续）；结束时红色「稍后重试」经查为 API 进程被会话中断 SIGTERM（环境因素），拉起后两端回到「已同步」 | `VERIFIED REAL` 2026-09-28 | `change_log`/`items`/`sync_conflicts` 查询 + 两端状态截图                                                      |

> 覆盖 `19_TEST_ACCEPTANCE_SPEC.md` 的 T-SYNC-001..008、T-REC-001..005 与 `docs/MULTI_DEVICE_VERIFICATION.md` 的 A–K 真实版。

---

## D. Physical Windows

**备注（2026-09-28）**：`Expected` 三项均已满足；另观察到**点击通知不会把浏览器窗口拉到前台**（Windows 11 禁止后台抢焦点 + 未调用 `window.focus()`），规格无独立条目但 §59「无论 App 是否打开…直接进入详情」隐含要求，作为缺口单独跟踪。

| #   | Initial state        | Operation                               | Expected                                                           | Actual                                                                                                                                                                                                                                                                                                                                                                                         | Result                     | Evidence                                       |
| --- | -------------------- | --------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ---------------------------------------------- |
| D1  | 权限未授予           | 首次用户手势后浏览器请求通知权限        | 系统/浏览器原生弹窗；拒绝也可用（回退应用内提示）                  | 权限重置为「询问」后，页面内**首次任意点击**即触发 Chrome 原生权限气泡（地址栏左上），用户点「允许」；权限状态=允许                                                                                                                                                                                                                                                                            | `VERIFIED REAL` 2026-09-28 | 用户实测记录（测试者决定不附截图）             |
| D2  | 权限已授予           | 创建 30 分钟内到期的有时间事项          | 到点出现系统通知；标题为事项标题                                   | 开始时间=当前+3 分钟、提醒等级=普通 → 到点 Windows 右下角系统通知，标题=`D2系统通知测试`，仅弹一次                                                                                                                                                                                                                                                                                             | `VERIFIED REAL` 2026-09-28 | 用户实测记录 + R-01 排程代码核对               |
| D3  | 通知已出现           | 点击通知                                | 打开**当前**事项详情（改期后是新值），该次通知被消费、事项状态不变 | 点击通知 → 该次通知被消费（不重复弹）、站内直接打开该事项详情、事项状态未变；**窗口未被自动带到前台**（需手动切回），见 §D 备注                                                                                                                                                                                                                                                                | `VERIFIED REAL` 2026-09-28 | 用户实测记录 + `notification.onclick` 代码路径 |
| D4  | 标签页后台/最小化    | 等待提醒触发                            | 后台标签页仍按 tick 交付（浏览器限制内）；回收后恢复               | 后台交付：应用标签页处于另一窗口时系统通知照常弹出；回收恢复：`chrome://discards` → `Urgent Discard` → 切回自动重载，登录态与列表完好；恢复后 `D4恢复测试`（09:32Z）服务端 **`DELIVERED`**（09:32:26 认领 / 09:32:28 投递，设备 `530a2f76`）。**观察项**：重载后页面一度读不到已授权状态导致未弹系统通知，重置站点权限后恢复 → 记为已知问题（观察级，不阻断；`.exe` 打包后改用原生通知即绕开） | `VERIFIED REAL` 2026-09-28 | `notification_deliveries` 行 + 用户实测记录    |
| D5  | 23:00–08:00 安静时段 | 制造已到期提醒                          | 不在安静时段发送，顺延到 08:00 之后                                | 待执行                                                                                                                                                                                                                                                                                                                                                                                         | `NOT RUN — PHYSICAL`       | 截图                                           |
| D6  | 系统缩放 125%/150%   | 浏览 360–1440px 布局与触控目标          | 无水平溢出、目标仍 ≥44px、文字可读                                 | 待执行                                                                                                                                                                                                                                                                                                                                                                                         | `NOT RUN — PHYSICAL`       | 截图                                           |
| D7  | 无鼠标               | Tab / Enter / Space / Escape 走完主流程 | 焦点可见、分层 Escape 正确、关闭后焦点回原处                       | 待执行                                                                                                                                                                                                                                                                                                                                                                                         | `NOT RUN — PHYSICAL`       | 录屏                                           |
| D8  | 焦点在详情内         | 切换事项/关闭详情                       | 焦点返回原行，不丢上下文                                           | 待执行                                                                                                                                                                                                                                                                                                                                                                                         | `NOT RUN — PHYSICAL`       | 录屏                                           |

---

### E 前置：让手机能访问本机服务

当前 API 固定监听 `127.0.0.1:3100`、Web dev server 固定 `127.0.0.1:5173`（安全默认，不对外暴露）。物理手机验收时二选一，并把改动记录进证据：

```bash
# 方案 1（推荐，不改代码）：USB 端口反向转发
adb reverse tcp:3100 tcp:3100
adb reverse tcp:5173 tcp:5173
# 方案 2：同网段临时放开监听（验收后必须改回并记录）
pnpm --filter @course-manager/web dev -- --host 0.0.0.0
# API 侧需临时把 main.ts 的 host 改为 0.0.0.0 并使用 HTTPS/受信网络
```

## E. Physical Mobile

| #   | Initial state      | Operation            | Expected                                  | Actual | Result               | Evidence |
| --- | ------------------ | -------------------- | ----------------------------------------- | ------ | -------------------- | -------- |
| E1  | 竖屏手机浏览器/PWA | 打开应用             | 底部导航、右下 Quick Capture、无水平滚动  | 待执行 | `NOT RUN — PHYSICAL` | 截图     |
| E2  | 列表中点事项       | 打开详情             | Bottom Sheet 自底部进入，主页面保留上下文 | 待执行 | `NOT RUN — PHYSICAL` | 录屏     |
| E3  | Sheet 内           | 编辑并保存           | 同一 Sheet 内切详情态，不跳页             | 待执行 | `NOT RUN — PHYSICAL` | 录屏     |
| E4  | Quick Capture 展开 | 弹出软键盘           | 输入框不被键盘遮挡，可连续记录            | 待执行 | `NOT RUN — PHYSICAL` | 录屏     |
| E5  | 月视图             | 点日期 → 单日 → 事项 | 钻取链路与详情语义一致                    | 待执行 | `NOT RUN — PHYSICAL` | 录屏     |
| E6  | 权限未授予         | 请求通知权限         | 原生流程；拒绝后应用内提示                | 待执行 | `NOT RUN — PHYSICAL` | 截图     |
| E7  | 应用切后台         | 等待提醒             | 回前台后状态一致；本地计划不丢            | 待执行 | `NOT RUN — PHYSICAL` | 录屏     |
| E8  | 系统字号/缩放放大  | 浏览主流程           | 文字可读、目标不重叠                      | 待执行 | `NOT RUN — PHYSICAL` | 截图     |

---

## F. Screen reader

| #   | Initial state               | Operation                          | Expected                                        | Actual | Result               | Evidence |
| --- | --------------------------- | ---------------------------------- | ----------------------------------------------- | ------ | -------------------- | -------- |
| F1  | Windows + NVDA（或等效）    | 朗读事项列表                       | 完成态同时由文本/图形表达，不只靠颜色           | 待执行 | `NOT RUN — PHYSICAL` | 录屏     |
| F2  | 同上                        | 打开并关闭详情                     | `aria-modal`/焦点管理被正确朗读，关闭后焦点返回 | 待执行 | `NOT RUN — PHYSICAL` | 录屏     |
| F3  | 移动端 TalkBack / VoiceOver | 走 Quick Capture → 提交 → 成功提示 | 焦点不被抢，反馈被朗读                          | 待执行 | `NOT RUN — PHYSICAL` | 录屏     |
| F4  | 同上                        | 分层 Escape / 返回                 | 不误关底层空间                                  | 待执行 | `NOT RUN — PHYSICAL` | 录屏     |

---

## G. 执行纪律

1. 每行填完 `Actual` 与 `Evidence` 才能改 `Result`。
2. 只有真实执行才能写 `VERIFIED REAL`；PGlite/双 Dexie 结果最高只能写 `VERIFIED SIMULATED`；本机测试与浏览器核对写 `VERIFIED LOCAL`。
3. 任一项 FAIL → 记录缺陷并回到工程 lane，不得改文档措辞掩盖。
4. 本 runbook 本身不产生任何 `VERIFIED` 标记。
