# ADR-009: Semester week calendar (natural weeks, configurable start day)

- 状态：Accepted（2026-09-28，产品拍板）
- 关联：`docs/ADR-005-collection-replacement-sync.md`、`15_DATABASE_SCHEMA.md`（`SemesterWeek.start_date/end_date`）

## 背景

`SemesterWeek` 只是 `week_number + start_date + end_date` 三个字段，规格**没有**规定一周如何划分（`16 §9` 的 `week_start` 是课表的"起始周"数字，与星期无关）。周次设置界面原本要求手填起止日期，产品判定为体验缺陷。

## 决定

1. **一周 = 公历自然周**，长度固定 7 天；**起始日可配置**（周日～周六，默认周一），不把"周一"写死。
2. **用户选周行，不填日期**：面板按周起始日把日期切成周行（按月分组），点选即绑定「周次 + 该周完整日期」。
3. **第一周永不推断**：没有任何周次时，界面只提示"先确定第一周"并把每行标为「选为第1周」，**不提供**周次输入、不显示任何推算；选定后才出现推算与补齐。
4. **推算规则**：以最早（周次最小）的已有周为锚点，其 `start_date` **按原样使用，绝不改写**；后续行按 7 天步长推算周次，点选可一次补齐锚点到目标之间的所有周（同编号覆盖、其余保留、结果按周次排序 —— 仍是整组替换语义）。
5. **搜索范围**：学期 `start_date/end_date` **各外扩 4 周**（`FIRST_WEEK_SEARCH_BUFFER_WEEKS = 4`），使"第一周早于学期开始日期"的学校也能选到。
6. **切换周起始日**后：只影响后续行的切分与推算；**已存在的周次日期保持不变**（避免静默改数据）。若锚点不再落在新的起始日上，推算自动暂停并给出红色提示与处理办法（移除后按新起始日重选第一周）。

## 偏好存储

- 登录状态：写入 Supabase 账户 `user_metadata.week_start_weekday`（**跨设备一致**，不新建表、不加迁移）。
- 未登录 / 尚未加载会话：读写本机 `localStorage`（`cm.week_start_weekday`）。
- 账户写入失败（离线）时以本机值生效，下次切换会重试；**不阻塞**任何操作。

## 影响面

- 无数据库迁移、无 API 契约变化、无同步协议变化（周次仍是整组替换，`002_collection_sync.sql` 不动）。
- 日期运算统一在 `apps/web/src/semesterWeeks.ts` 内以 UTC 计算，避免时区把日期推移一天。

## Verification

- `semesterWeeks.test.ts`：周一/周日/周六起始的切分、推算与补齐、锚点日期不被改写、跨日历推算暂停、同编号覆盖保序。
- `SemesterWeekEditor.test.tsx`：空状态提示、推算徽标、外扩 4 周可选到学期前的第一周、切换起始日后所有行改变且不含 `type="date"` 输入。
- 真实环境验收：见 `docs/FINAL_RELEASE_VALIDATION.md` C12（学期周整组冲突）。
