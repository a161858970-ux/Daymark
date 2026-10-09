# ADR-010 — DATE / DATETIME 时间精度与捕获时区

**状态**：已批准（任务书 Gate 0）  
**日期**：2026-10-09  
**范围**：自然语言记录与时间语义完整升级

## 背景

现有 Item 时间字段（`start_at` / `occurrence_start_at` / `occurrence_end_at` / `due_at`）全部是 `timestamptz` / ISO instant。产品语义上存在两种用户意图：

- **DATE**：用户只给出日历日期（「10.12截止」「下周三课堂展示」）
- **DATETIME**：用户给出明确日期及具体钟点（「明天下午3点」「10.12 15:00截止」）

当前实现没有精度区分，日期被伪装成 `00:00` 或 `23:59` 哨兵，导致日历假造钟点、提醒边界算错、标题提纯无法安全删除时间成分。

## 决定

### 1. 字段表示（最小兼容扩展）

保留既有 `*_at` 字段表示 **DATETIME 精度的 UTC instant**（旧数据迁移后一律按 DATETIME 处理，含义不变）。

为每个时间语义新增 **date-only 配对字段**：

| 语义   | DATETIME              | DATE                    |
| ------ | --------------------- | ----------------------- |
| 开始   | `start_at`            | `start_date`            |
| 发生起 | `occurrence_start_at` | `occurrence_start_date` |
| 发生止 | `occurrence_end_at`   | `occurrence_end_date`   |
| 截止   | `due_at`              | `due_date`              |

不变量：

- 每一语义同一端点至多一侧非空：`*_at` 与 `*_date` **不得同时非空**。
- DATE 值为 `YYYY-MM-DD` 日历本体，**绝不**通过 UTC 午夜猜用户日期。
- 旧 `*_at` 时间戳原样保留 instant 语义；不把历史行静默转成 DATE。

### 2. 捕获时区与解释时区

- `RawCapture.captured_tz`：记录时的 IANA 时区（新写入必填；历史可空）。
- `Item.time_zone`：解释 date-only 字段、当地日界与提醒锚点所用 IANA 时区。创建时取捕获时区；人工编辑时取用户当前 IANA 时区。
- 相对日期（今天/明天/下周二/第 N 周）一律以 `captured_at` + `captured_tz` 的**当地日**为基准，不以解析执行时的“今天”为基准。
- 历史 RawCapture 无 `captured_tz` 时：依赖时区的相对表达**不自动定日期**，保留原话。

### 3. 行为边界（与任务书 §2.6 一致）

- **DATE due**：UI 只显示日期；提醒引擎用「下一当地日 00:00」作独占截止边界判断逾期/lead，不依赖伪 `23:59`。
- **DATE occurrence**：日历全天/日期段；发生前提醒锚点 = 发生日期当地 **09:00**，再套 R-01 lead。
- **DATE occurrence range**：发生后提醒从**最后一日当地日终**（次日 00:00 独占）起算。
- **DATE start**：不显示假钟点；**不**仅凭 DATE 生成 09:00 start reminder（只有显式 DATETIME start 才走既有 start 规则）。
- **DATETIME**：继续沿用现有 R-01 精确时刻语义，不受 DATE 功能影响。
- 夏令时/时区切换用 IANA 规则；禁止写死 UTC+8 或固定毫秒偏移推自然日。

### 4. 同步与兼容

- 新字段全部 nullable；旧客户端 payload 缺省视为 null，旧 `*_at` 语义不变。
- 新客户端读到仅有 `*_at` 的历史行 → 按 DATETIME。
- 新客户端写 DATE 时只写 `*_date`；写 DATETIME 时只写 `*_at`。
- outbox / conflict / API DTO / Zod / Postgres / Dexie 全链路传播新字段。
- 旧 payload 若同时给出冲突的 `*_at` 与 `*_date` → 校验拒绝，不静默选边。

### 5. 数据库

- **Postgres** `007_date_precision.sql`（前向、不改历史迁移）：`raw_captures.captured_tz text`；`items.start_date / occurrence_start_date / occurrence_end_date / due_date date`；`items.time_zone text`；CHECK 互斥与 occurrence 日期序。
- **Dexie v7**：upgrade 写入缺省 null；索引可加 `due_date` 便于排序（不改库名 `course-manager`）。

### 6. 不采用的方案

- 继续用 `00:00`/`23:59` 哨兵伪装 DATE。
- 把 date-only 存成 UTC 午夜 instant。
- 用固定 +8 偏移算当地日。
- 旧时间戳静默降级为 DATE。

## 后果

- domain / contracts / storage / API / UI / calendar / reminder 需同步感知精度。
- 标题提纯仅在时间成分被 `*_at` 或 `*_date` 真实承接后才允许移除。
- 发布后需一轮真机/桌面人工验收（全天日历、日期截止提醒、跨时区）。
