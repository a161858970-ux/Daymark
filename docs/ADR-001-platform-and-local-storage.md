# ADR-001 — 平台和本地持久化

**状态**：已采用，2026-09-22。

## 背景

正式规格 `14_TECHNICAL_ARCHITECTURE.md` 推荐 Expo/Tauri、SQLite 与 Supabase。此次工程交接明确给出 React/TypeScript/Vite、Dexie/IndexedDB、Node/Fastify、PostgreSQL 的默认方向，且原目录没有既有代码或平台约束。

## 决定

采用 pnpm TypeScript workspace，将 domain、application、storage、API 与 UI 分开。浏览器前端使用 IndexedDB/Dexie 执行本地事务，先保存 RawCapture，随后异步处理。服务端采用 Fastify 与 PostgreSQL 迁移，API 与同步通过后续阶段的端口/适配器连接。

## 约束与后果

- 此决定只替换技术适配器，不修改 Mobile/Windows 布局、Item 身份、日程/课程表边界或其他产品规则。
- IndexedDB 不等同于原生平台的 SQLite：浏览器清除站点数据会影响离线记录，正式跨端数据保护依赖后续同步与恢复验收。
- 原生通知、后台运行和 Windows/Mobile 安装包仍需平台适配；普通浏览器页面不能被当作已具备完整原生能力。
- 本地 `capture_contexts` 表保存中断解析时的课程上下文，不成为新的业务实体，也不改变正式 RawCapture 原文和服务器 schema。
- API 业务路由在认证与 owner scope 可验证前不得暴露；当前只提供公开健康检查。
