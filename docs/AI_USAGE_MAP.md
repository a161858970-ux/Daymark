# AI 使用面（事实核查，2026-09-30）

> 本文按**实际代码与实测**整理，不依据设计文档推断。结论：全项目只有**两个**真实 AI 调用点，全部在 `apps/api`，全部走同一个 OpenAI 兼容端点。

## 0. 供应商与端点

| 项           | 值                                                                                                                                                                      |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 端点         | `${AI_BASE_URL}/chat/completions`，默认 `https://api.xiaomimimo.com/v1`                                                                                                 |
| 模型         | `AI_MODEL`，默认 `mimo-v2.6-flash`（推理模型，会输出 `reasoning_content`）                                                                                              |
| 密钥         | `AI_API_KEY`（兼容旧名 `MIMO_*` / `OPENAI_*`），只在 API 进程内使用                                                                                                     |
| 输出约束     | 两处都用 `response_format: { type: "json_schema", strict: true }`                                                                                                       |
| 限流         | 同一个 `RateLimiter`，按 authenticated owner，默认 `AI_RATE_LIMIT_PER_OWNER=20` / `AI_RATE_LIMIT_WINDOW_MS=60000`，**只在真正调 provider 前判定**（确定性路径不扣配额） |
| 实测可用模型 | `mimo-v2.5`、`mimo-v2.5-pro`、`mimo-v2.6-flash`、`mimo-v2.6-pro`、`mimo-v2.6-pro-ultraspeed`（另有 asr/tts 系列）                                                       |

## 1. 调用点 A：捕获解释（"尝试智能整理"）

- **入口**：`POST /api/v1/ai/capture-interpretations`（`server.ts`）→ `CaptureInterpretationService.interpret`（`apps/api/src/ai/interpretation.ts`）
- **前端触发**：`apps/web/src/authSync.ts` 的 `fetch("/api/v1/ai/capture-interpretations")`，由 `PendingCapture` 的「尝试智能整理」按钮调用；**不是**快速记录的默认路径
- **是否花钱的判定顺序**：
  1. 先跑确定性 `preprocessCapture`（规则解析）；
  2. 结果是 `ITEM` / `COURSE_INFORMATION` / 拆分候选 → 直接返回 `source: "DETERMINISTIC"`，**不发 AI 请求**；
  3. 只有确定性判不出（UNRESOLVED）→ `gateAi()` 限流 → 调 provider → `source: "AI"` 且 `requires_confirmation: true`
- **请求形态**：system prompt（严格约束：字符串必须是原文子串、不得编造时间/优先级/计划）+ user 内容为输入 JSON；超时默认 90 s，瞬时错误重试一次
- **输出校验**：`interpretationSchema` + `supportedBySource()`（子串回查、课程名必须真实存在、无时间词时不得给时间字段等），不通过 → `AI_INVALID_OUTPUT 502`
- **失败表现**：`AI_UNAVAILABLE 503`（provider 未配置/调用失败）

## 2. 调用点 B：课程表导入解析

- **入口**：`POST /api/v1/course-imports/:id/source`（上传源文件后触发）→ `CloudCourseImportManager`（`apps/api/src/db/course-import.ts`）→ `ChatCompletionsCourseImportParser`（`apps/api/src/ai/course-import-chat-parser.ts`）
- **前端触发**：`apps/web/src/courseImportClient.ts`（选文件 → 上传 → 等预览）
- **PDF 预处理**（`apps/api/src/ai/pdf-source.ts`，**不花 token**）：
  - 文字层可信（全文 ≥ `minUsableTextChars` 120 字）→ 走**文字**（便宜、精确），单次请求
  - 不可信/扫描版 → 每页栅格化为 JPEG（≤1600px、q72、总图 ≤6 MB、≤8 页、≤20 页），**每批 ≤4 张图**，多批分别请求后 `mergeCoursePreviews` 合并
  - 必须加载 pdfjs 自带 `cmaps/` + `standard_fonts/`，否则中文字体（CID，如 `UniGB-UCS2-H`）既提不出字也画不出字（见 §4）
- **超时**：300 s/批，重试 2 次；限流同上
- **输出校验**：`courseImportParseResultSchema`，其中 `courses` **`min(1)`** —— 空数组会抛 Zod 错误（见 §4 的文案问题）

## 3. 哪些地方**没有**用 AI（实测/代码确认）

| 功能                           | 实现                                                                                     |
| ------------------------------ | ---------------------------------------------------------------------------------------- |
| 快速记录的常规解析             | 纯规则 `preprocessCapture`（`packages/application/src/captureParsing.ts`），不发网络请求 |
| 搜索                           | 本地规范化关键词匹配                                                                     |
| 提醒 / 日历 / 同步 / 冲突合并  | 规则与协议，本地或 SQL                                                                   |
| 课程导入的去重、原子提交、幂等 | SQL 事务，非 AI                                                                          |

## 4. 真实 smoke 与实测结论

- `pnpm verify:ai` → `PASS interpretation`；`pnpm verify:ai --with-import` → `PASS import … courses=3`（2026-09-30 复跑仍通过）
- **MiMo 不接受 PDF 文件输入**（2026-09-30 实测）：`file` 类型 content part → `400 file type is not supported`（`mimo-v2.6-flash` / `mimo-v2.6-pro` / `mimo-v2.5-pro` 三档一致）；`GET/POST /v1/files` → `404`。`image_url` → `200` 正常识别。**因此"文字提取 + 栅格化图片"是当前唯一可行方案，不是次优解。**
- **课表导入失败根因（已修复）**：`pdfjs.getDocument()` 没传 `cMapUrl` → 中文 CID 字体解不出 → 文字层 0 字、栅格化出**空白表格图** → 模型返回 `{"courses":[]}` → `courses.min(1)` 校验失败 → 兜底文案"无法可靠识别该课程表…"（误导，文件本身没问题）。修复后同一份真实课表提取 **5207 字**、模型返回 **8+ 门课**（含教师/周次/教室），端到端通过（耗时 213 s，接近 300 s 上限，见下）。
- **遗留观察项**：
  1. 空结果/校验失败时给用户的文案是"文件不清晰"，与真实原因（模型没识别出课程）不符；
  2. `providerFailure()` 丢弃底层异常（不保留 `cause`），排障只能靠复现；
  3. 大课表结构化解析耗时 213 s，逼近 300 s 上限，重试可能超时。
