# AI 使用面（事实核查，2026-09-30；**2026-10-07 供应商切换 DeepSeek，见文末 §变更**）

> 本文按**实际代码与实测**整理，不依据设计文档推断。结论：全项目只有**两个**真实 AI 调用点，全部在 `apps/api`，全部走同一个 OpenAI 兼容端点。

## 0. 供应商与端点

| 项           | 值                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 端点         | `${AI_BASE_URL}/chat/completions`，默认 `https://api.xiaomimimo.com/v1`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 模型         | 文本路 `AI_MODEL`，默认 `mimo-v2.6-pro`；图片批次 `AI_MODEL_IMAGE`，默认 `mimo-v2.6-flash`。**决策依据（2026-10-05 基准，整册单批管线 + 22 门参考名单）**：`mimo-v2.6-pro` 3/3 满分（22 门/28 条/周次[1-5]/28 条无时间，均值 70s，0.435/0.87 与 v2.5-pro 同价）；`mimo-v2.6-flash` 文本路 724s 全预算超时（保留图片路：视觉合格、0.14/0.28 最便宜）；`mimo-v2.6-pro-ultraspeed` 垃圾 JSON 且计费 10×pro，弃用。**v2.5 系 2026-10-21 10:00 下线**，`mimo-v2.5-pro` 曾因图片 404 只做文本、文本 51-201s 质量稳定。AI_MODEL 兼容旧名 `MIMO_*` / `OPENAI_*` |
| 密钥         | `AI_API_KEY`（兼容旧名 `MIMO_*` / `OPENAI_*`），只在 API 进程内使用                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 输出约束     | 两处都用 `response_format: { type: "json_schema", strict: true }`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 限流         | 同一个 `RateLimiter`，按 authenticated owner，默认 `AI_RATE_LIMIT_PER_OWNER=20` / `AI_RATE_LIMIT_WINDOW_MS=60000`，**只在真正调 provider 前判定**（确定性路径不扣配额）                                                                                                                                                                                                                                                                                                                                                                                 |
| 实测可用模型 | `mimo-v2.5`、`mimo-v2.5-pro`、`mimo-v2.6-flash`、`mimo-v2.6-pro`、`mimo-v2.6-pro-ultraspeed`（另有 asr/tts 系列）                                                                                                                                                                                                                                                                                                                                                                                                                                       |

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
  1. ~~空结果文案误导~~ **已修**（`b763063`）：模型返回 0 门课 → 新 `NO_COURSES` 文案「未从该文件中识别出课程…」，与"文件读不出"（`NO_CONTENT`）分流，测试改为精确断言；
  2. ~~`providerFailure()` 丢弃底层异常~~ **已修**：`ProviderError`/`CloudError` 均携带 `cause`，`interpretation.ts` 的裸 `catch` 改为 `catch (error)`，`server.setErrorHandler` 把工程原因写 stderr（落 `%TEMP%\cm-api.log`）、意外 500 也记一行；**响应体仍是产品文案**（测试双向断言：日志含原因、响应不含）；
  3. ~~大课表结构化解析耗时 213 s，逼近 300 s 上限~~ **已解决（2026-10-05）**：整册单批 + 模型分路后实测 33–70 s；2026-10-07 起改走 deepseek-flash（见文末变更节）。

## 变更（2026-10-07）：课表识别与 AI 解释切 DeepSeek V4.1-Flash

- **触发（真实事故）**：内测新用户（`523280e1…`，21:36 注册）21:56 提交真实 PDF 课表导入，`course_import_jobs` 记录 **21:56:33 → 22:08:37 FAILED，错误「识别服务响应超时」**——耗时精确等于 `240 s × 3 次重试 + 2 s 间隔 ≈ 12:02`，三次尝试全部被供应商挂起超时（服务器 `notification_deliveries` 类比通道无当日记录、任务 preview 全空，排除我方解析与文件问题）。
- **切换**：`AI_BASE_URL=https://api.deepseek.com`、`AI_MODEL=deepseek-flash`、`AI_MODEL_IMAGE=deepseek-flash`（= DeepSeek-V4.1-Flash，2026-09-10 发布；原生图片输入；峰时 $0.30/$1.20 每百万 token；非思考档首 token 极快）。
- **适配层 `apps/api/src/ai/providerCompat.ts`（按 base URL 自动分流）**：
  - DeepSeek Chat 端点只有 `response_format: json_object`（`json_schema` 是 Responses API 能力）→ 结构改由**提示词内嵌 JSON Schema 指令**保证（官方警示：json_object 模式不指示会空转到 token 上限，故指令注入是硬要求）；
  - `thinking: {"type": "disabled"}` 关思考档（用户拍板"关低思考挡位"）；
  - 非 DeepSeek（MiMo 默认）payload **逐字节保持原样**（json_schema 严格档），默认路径测试原封不动。
- **切回/再切**：纯环境变量（`AI_BASE_URL/AI_MODEL/AI_MODEL_IMAGE/AI_API_KEY`），代码无需改动。
- **调用点不变**：仍然只有两个（`interpretation.ts` 的解释、`course-import-chat-parser.ts` 的导入），限流 20/owner/min 不变。
