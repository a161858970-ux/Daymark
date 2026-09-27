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

**前置**

```bash
# 可丢弃数据库（任选其一：本机 PostgreSQL / docker run postgres:16）
createdb course_manager_release
# 仓库根 .env 或 shell：
DATABASE_URL=postgres://<user>:<pass>@127.0.0.1:5432/course_manager_release
REAL_DATABASE_URL=postgres://<user>:<pass>@127.0.0.1:5432/course_manager_release
```

| #   | Initial state | Operation                                                             | Expected                                                                                                           | Actual | Result                             | Evidence                                         |
| --- | ------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------ | ---------------------------------- | ------------------------------------------------ |
| A1  | 空数据库      | `pnpm db:migrate`                                                     | 依次应用 `001_initial` `002_collection_sync` `003_course_import` `004_reminder_delivery`；`schema_migrations` 4 行 | 待执行 | `BLOCKED — EXTERNAL CONFIGURATION` | 迁移终端输出 + `SELECT * FROM schema_migrations` |
| A2  | 迁移完成      | `pnpm test:postgres`                                                  | `real-postgres.integration.test` 不再 skip，全绿                                                                   | 待执行 | `BLOCKED — EXTERNAL CONFIGURATION` | 测试终端输出（无 skipped）                       |
| A3  | 迁移完成      | `ALLOW_DEVELOPMENT_SEED=1 pnpm db:seed`（仅本地可丢弃库）             | seed 成功；不设开关时 seed 必须拒绝                                                                                | 待执行 | `BLOCKED — EXTERNAL CONFIGURATION` | seed 输出 + 无开关时的报错                       |
| A4  | 迁移完成      | `pnpm verify:live-api`（配 `API_BASE_URL` + `SUPABASE_ACCESS_TOKEN`） | 受保护接口返回数据而非 401                                                                                         | 待执行 | `BLOCKED — EXTERNAL CONFIGURATION` | 脚本输出                                         |

---

## B. Supabase（认证 + 真实 API）

**前置**：Supabase 项目；根 `.env`：

```
SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<anon/publishable key>
SUPABASE_ACCESS_TOKEN=<访问令牌，用于只读 live smoke>
```

| #   | Initial state | Operation                                                 | Expected                                                  | Actual | Result                             | Evidence                                 |
| --- | ------------- | --------------------------------------------------------- | --------------------------------------------------------- | ------ | ---------------------------------- | ---------------------------------------- |
| B1  | 无配置        | 写入上述变量并 `pnpm dev`                                 | API 注册认证业务路由（不再只有 health）；前端出现登录入口 | 待执行 | `BLOCKED — EXTERNAL CONFIGURATION` | `/api/v1/health` 与登录入口截图          |
| B2  | 未登录        | 浏览器登录（Auth v1：手机号验证码 / 邮箱验证码 / Google） | 得到 session，owner 为 `auth.users.id`                    | 待执行 | `BLOCKED — EXTERNAL CONFIGURATION` | 会话截图（见 `AUTH_REAL_VALIDATION.md`） |
| B3  | 已登录        | 本地快速记录 → 观察同步                                   | outbox 推送 → 服务端入库 → pull 收敛                      | 待执行 | `BLOCKED — EXTERNAL CONFIGURATION` | push/pull 请求与响应                     |
| B4  | 已登录        | `SUPABASE_ACCESS_TOKEN` 下 `pnpm verify:live-api`         | 通过                                                      | 待执行 | `BLOCKED — EXTERNAL CONFIGURATION` | 脚本输出                                 |
| B5  | 已登录        | 401/403 路径（过期 token 调用受保护接口）                 | 稳定错误码 `AUTH_REQUIRED`，产品文案，无内部细节          | 待执行 | `BLOCKED — EXTERNAL CONFIGURATION` | 响应体                                   |

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

| #   | Initial state            | Operation                          | Expected                                         | Actual | Result               | Evidence     |
| --- | ------------------------ | ---------------------------------- | ------------------------------------------------ | ------ | -------------------- | ------------ |
| C1  | A、B 各自空库            | A 离线（DevTools offline）快速记录 | `✓ 已记录`，A 本地可见                           | 待执行 | `NOT RUN — PHYSICAL` | 截图         |
| C2  | A 离线已记录             | 刷新 A                             | 记录仍在（重启/刷新不丢）                        | 待执行 | `NOT RUN — PHYSICAL` | 截图         |
| C3  | A 恢复网络               | 观察 A 自动同步                    | outbox 自动推送，无需手动                        | 待执行 | `NOT RUN — PHYSICAL` | 网络面板     |
| C4  | A 已同步                 | B 拉取                             | B 看到同一条记录                                 | 待执行 | `NOT RUN — PHYSICAL` | 两端截图     |
| C5  | A、B 同条目              | 非重叠字段分别编辑                 | 自动合并，无冲突提示                             | 待执行 | `NOT RUN — PHYSICAL` | 两端字段截图 |
| C6  | A、B 同条目              | 同字段（截止时间）分别编辑         | 显式冲突，只列该字段                             | 待执行 | `NOT RUN — PHYSICAL` | 冲突 UI 截图 |
| C7  | 冲突可见                 | 选择本机/已同步/显式值并解决       | 收敛到所选值，写入 revision                      | 待执行 | `NOT RUN — PHYSICAL` | 解决前后截图 |
| C8  | 解决后                   | 立即再编辑一次                     | 后续编辑不被旧 resolution 覆盖                   | 待执行 | `NOT RUN — PHYSICAL` | 两端截图     |
| C9  | A 删除、B 编辑同条目     | 观察结果                           | 不静默复活；保留删除或进入显式处理               | 待执行 | `NOT RUN — PHYSICAL` | 截图         |
| C10 | 已删除条目               | 限时 Undo 过期后再尝试 undo-delete | 拒绝 undelete，只能采用已同步 tombstone          | 待执行 | `NOT RUN — PHYSICAL` | 响应/截图    |
| C11 | A、B 各改 CourseSchedule | 并发整组替换                       | 整组冲突：只能选完整本机组或完整已同步组         | 待执行 | `NOT RUN — PHYSICAL` | 冲突 UI 截图 |
| C12 | A、B 各改 SemesterWeek   | 并发整组替换                       | 同 C11                                           | 待执行 | `NOT RUN — PHYSICAL` | 冲突 UI 截图 |
| C13 | 双端有未决状态           | 关闭并重开两个 profile             | outbox 继续推送，unresolved 记录复现，无重复对象 | 待执行 | `NOT RUN — PHYSICAL` | 重启前后截图 |
| C14 | 网络抖动环境             | 长时间重试（断续网络 ≥30 分钟）    | 无重复条目、无卡死、ACTION_REQUIRED 有用户出口   | 待执行 | `NOT RUN — PHYSICAL` | 日志/截图    |

> 覆盖 `19_TEST_ACCEPTANCE_SPEC.md` 的 T-SYNC-001..008、T-REC-001..005 与 `docs/MULTI_DEVICE_VERIFICATION.md` 的 A–K 真实版。

---

## D. Physical Windows

| #   | Initial state        | Operation                               | Expected                                                           | Actual | Result               | Evidence  |
| --- | -------------------- | --------------------------------------- | ------------------------------------------------------------------ | ------ | -------------------- | --------- |
| D1  | 权限未授予           | 首次用户手势后浏览器请求通知权限        | 系统/浏览器原生弹窗；拒绝也可用（回退应用内提示）                  | 待执行 | `NOT RUN — PHYSICAL` | 截图      |
| D2  | 权限已授予           | 创建 30 分钟内到期的有时间事项          | 到点出现系统通知；标题为事项标题                                   | 待执行 | `NOT RUN — PHYSICAL` | 截图/录屏 |
| D3  | 通知已出现           | 点击通知                                | 打开**当前**事项详情（改期后是新值），该次通知被消费、事项状态不变 | 待执行 | `NOT RUN — PHYSICAL` | 录屏      |
| D4  | 标签页后台/最小化    | 等待提醒触发                            | 后台标签页仍按 tick 交付（浏览器限制内）；回收后恢复               | 待执行 | `NOT RUN — PHYSICAL` | 录屏      |
| D5  | 23:00–08:00 安静时段 | 制造已到期提醒                          | 不在安静时段发送，顺延到 08:00 之后                                | 待执行 | `NOT RUN — PHYSICAL` | 截图      |
| D6  | 系统缩放 125%/150%   | 浏览 360–1440px 布局与触控目标          | 无水平溢出、目标仍 ≥44px、文字可读                                 | 待执行 | `NOT RUN — PHYSICAL` | 截图      |
| D7  | 无鼠标               | Tab / Enter / Space / Escape 走完主流程 | 焦点可见、分层 Escape 正确、关闭后焦点回原处                       | 待执行 | `NOT RUN — PHYSICAL` | 录屏      |
| D8  | 焦点在详情内         | 切换事项/关闭详情                       | 焦点返回原行，不丢上下文                                           | 待执行 | `NOT RUN — PHYSICAL` | 录屏      |

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
