# ADR-007 — AI endpoint rate limit

**状态**：Accepted，2026-09-26（Final Release Gate Preparation）

## Context

规格三处要求对 AI 端点限流，但都**没有给出数字**：

- `16_API_CONTRACT.md` §22.4：`Apply rate limits to AI endpoints.`
- `14_TECHNICAL_ARCHITECTURE.md` §2.5 AI Gateway：`rate limiting` 是网关职责之一。
- `18_AI_PIPELINE_SPEC.md`：AI 必须是异常/必要分支，并要求可观测的调用指标。

因此数字属于**工程安全默认值（security default）**，不是产品行为，不能写成产品语义，也不能因为"常见 App 有设置页"而把它暴露给用户。

## Decision

### 1. 限制对象：只有真正调用 provider 的路径

- `POST /api/v1/ai/capture-interpretations`：确定性解析能给出结论时**不扣配额**；只有即将调用 `InterpretationProvider` 时才 `check()`。
- `POST /api/v1/course-imports/{id}/source`：只有配置了 parser（即会调用 AI）时才 `check()`；无 provider 时不产生配额。

普通 capture / resolve / sync 等非 AI 接口完全不受影响。

### 2. 限制主体：authenticated owner

所有 AI 端点都在 JWT 之后，没有未认证的 AI 入口，因此桶键为 `owner:<uuid>`；不需要额外的 IP 桶（若未来出现免认证 AI 入口，再补第二层）。

同一 `RateLimiter` 实例在 `main.ts` 中注入解释服务与导入服务，所以 owner 的 AI 总预算在两个端点之间共享。

### 3. 数字（可配置，非法值回落默认）

| 环境变量                  | 默认    | 含义                              |
| ------------------------- | ------- | --------------------------------- |
| `AI_RATE_LIMIT_PER_OWNER` | `20`    | 每 owner 每窗口允许的 AI 调用次数 |
| `AI_RATE_LIMIT_WINDOW_MS` | `60000` | 窗口长度（固定窗口）              |

实现：`apps/api/src/rateLimit.ts` 的 `RateLimiter`（固定窗口、可注入时钟、过期桶清理、`reset()` 仅供测试）。

### 4. 触发时的契约

- HTTP **429**，稳定错误码 **`RATE_LIMITED`**（`16_API_CONTRACT.md` §19 已列出该码）。
- 响应头 **`Retry-After`**（秒，剩余窗口时间，最小 1）。
- message：`请求过于频繁，请稍后再试。` —— 不暴露桶、窗口、计数等实现细节。
- **无副作用**：解释限流发生在 provider 调用之前 → RawCapture 保留、不建 Item；导入限流发生在 `parser.parse` 与 job 状态更新之前 → job 保持原状态、不写 `FAILED`、不产生半成品 Course、不 commit。
- 客户端无法绕过：判定只在服务端，客户端既看不到配额也改不了判定。

## Consequences

- 配额是安全护栏：合法的连续快速记录（确定性路径）不受影响；只有昂贵的模型调用受限。
- 进程内内存桶 → 单实例部署有效；多实例部署时需要共享存储（当前架构为单进程本地部署，记录为发布前注意事项）。
- 触发时 UI 显示中文产品文案（Web `toUserMessage` 已映射 `RATE_LIMITED`）。

## Verification

- `apps/api/src/rateLimit.test.ts`：边界（第 N 次允许、N+1 拒绝）、retry-after 随窗口递减、per-owner 隔离、env 解析与非法值回落、`reset` 只清单键。
- `apps/api/src/ai/interpretation-rate-limit.test.ts`：确定性路径 5 次全部 200 且 provider 调用数为 0（不扣配额）；AI 路径第 3 次 429 + `Retry-After` + 错误码/文案；响应不含实现词汇；RawCapture 保留、Item 数为 0；另一 owner 不受影响；窗口过期后恢复。
- `apps/api/src/db/course-import.test.ts`：第一次解析 200 → 第二次 429 + `Retry-After`，job 仍为 `READY`、`error_message` 仍为 null、未 commit 任何 Course。
