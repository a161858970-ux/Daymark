# ADR-006 — 扫描版 PDF 导入与 provider 边界

**状态**：Accepted，2026-09-26（Release Candidate Hardening）

## Context

课程导入的规格要求同时支持 PDF 与图片，但当前 provider（MiMo，OpenAI 兼容 Chat Completions）只接受 `bmp/gif/png/jpeg/webp`，`file` 输入直接返回 400 `file type is not supported`。同时，扫描版 PDF 没有文本层，此前只能提示用户“把 PDF 转成图片”，这是把实现限制转嫁给用户，不作为最终方案。

另一个约束是 payload：一次请求不能塞进几十页高分辨率图片。

## Decision

### 1. 按页选择输入方式

`apps/api/src/ai/pdf-source.ts` 的 `preparePdfSource()`：

1. 逐页提取文本；
2. 文本层可信（全文 ≥ `minUsableTextChars`，120 字符）时，单页 ≥ `pageTextMinChars`（40 字符）的页走**文本**输入，其余页走**栅格化**；
3. 文本层过少（典型扫描件：只有页码、页眉）时，**全部页栅格化**，不信任零散文本；
4. 结果按 `imageBatches()` 分批（每请求 ≤ 4 张图），多批结果用 `mergeCoursePreviews()` 按课程名合并、去重 schedule。

### 2. 受控的栅格化预算

| 限制                                        | 值               | 超限行为                               |
| ------------------------------------------- | ---------------- | -------------------------------------- |
| 总页数 `maxPages`                           | 20               | `TOO_MANY_PAGES`，提示拆分文件         |
| 可栅格化页数 `maxRasterPages`               | 8                | `TOO_MANY_SCANNED_PAGES`，提示拆分文件 |
| 单页最长边 `maxPageDimension`               | 1600px，JPEG q72 | 缩放后重新编码                         |
| 全部图片 base64 预算 `maxImagePayloadBytes` | 6 MB             | `TOO_LARGE`，提示压缩                  |
| 单请求图片数                                | 4                | 自动分批                               |

课程表常见输入（1–4 页）落在单请求内。

### 3. 失败必须可恢复且用产品语言

`preparePdfSource()` 抛 `CourseImportParseError`（带 `userMessage`），provider 侧抛 `ProviderError`（`AUTH / RATE_LIMITED / TIMEOUT / UNAVAILABLE / INVALID_REQUEST / MALFORMED`）。`CloudCourseImportManager.parseSource()` 用 `importFailureMessage()` 映射成中文产品文案写入 `error_message`，job 保持 `FAILED` 可重试，**不产生半成品课程**，也不向用户暴露 status code、base64、堆栈。

### 4. 重试边界

`withProviderRetry()` 只对瞬时类重试一次（500ms/1000ms 退避）：`TIMEOUT / UNAVAILABLE / RATE_LIMITED / EMPTY`；`AUTH / INVALID_REQUEST / MALFORMED / TRUNCATED` 不重试。响应读取统一走 `readStructuredResponse()`：200 但正文不是 JSON → `UNAVAILABLE`（网关串扰，重试）；`finish_reason=length` → `TRUNCATED`（提示拆分文件，不重试）；有信封但 content 为空 → `EMPTY`（重试）；content 不是合法 JSON → `MALFORMED`（不重试）。导入与解释共用同一套分类，超时时间分别为 300s / 90s（推理模型需要远超旧的 15s 预算）。

### 5. 原始字节仍不入库

栅格化图片只存在于单次请求内，`course_import_jobs` 仍只保存 normalized preview、source hash/name/media type 与用户决定；重复导入同源文件继续走 `(owner, semester, source hash)` 幂等。

## Consequences

- 扫描版 PDF 可直接导入，不再要求用户转换文件。
- 多页扫描件的总耗时随批次数线性增长；超过 8 张扫描页会被明确拒绝而不是悄悄丢页。
- 依赖 `@napi-rs/canvas`（预编译二进制）与 `pdfjs-dist`，平台无编译步骤。
- 混合 PDF（部分页有文本）按页分流，文本页仍走便宜的文本路径。

## Verification

- `apps/api/src/ai/pdf-source.test.ts`：文本页路径、扫描页栅格化（JPEG magic bytes）、超页数/超扫描页/超 payload 三类拒绝、不可读文件映射为可读文案、分批与合并去重。
- `apps/api/src/ai/course-import-provider.test.ts`：文本 PDF 走文本、扫描 PDF 走 `data:image/jpeg`（且不含 `input_file`、不含原始 PDF 字节）、500 重试一次、401 不重试、超时与非 JSON 响应分类。
- `apps/api/src/db/course-import.test.ts`：provider 失败与 `TOO_LARGE` 的中文文案、15 MB 超限拒绝、失败后 job 可恢复到 `READY`。
- 真实 provider smoke：`pnpm verify:ai --with-import`（扫描 fixture，2 页）→ `PASS interpretation 28240ms`、`PASS import 37633ms courses=3`。
