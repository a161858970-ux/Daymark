# ADR-002 — 认证 API 与 owner scope

**状态**：已采用，2026-09-22；同步核心已在测试中贯通，浏览器会话监听已接入但缺账号入口与真实项目验证。

## 背景

`16_API_CONTRACT.md` 要求受保护 mutation 由已验证 token 确定 owner，支持幂等重试、乐观并发和删除 Undo。`14_TECHNICAL_ARCHITECTURE.md` 推荐 Supabase Auth；本次交接选择 Fastify 作为业务 API。

## 决定

API 使用 Fastify + PostgreSQL。配置 `DATABASE_URL` 与 `SUPABASE_URL` 后，从 Supabase Auth 的 [JWKS endpoint](https://supabase.com/docs/guides/auth/signing-keys) 获取公钥；用 `jose` 验证 JWT 的签名、issuer、`authenticated` audience、角色和 UUID subject。未同时配置数据库与认证时仅注册公开健康检查，业务路由不开放。测试使用本地签名密钥和嵌入式 PostgreSQL。

所有数据库查询使用 token subject 作为 `owner_id` 条件；请求 body 的 `owner_id` 不参与授权。创建请求通过 `Idempotency-Key` 与数据库记录避免重复；Item 变更使用 `If-Match`，同字段竞争记录为 SyncConflict，非重叠 Item 编辑可合并。删除 Undo 采用短时随机 token 的哈希，独立于完成状态 restore。

## 后续约束

- Web 在首次认证后可通过 sync worker 将离线 owner 绑定到 token owner；已有会话时自动运行，当前缺账号入口和真实项目验证。不能将本地随机 ID 当作服务器认证。具体边界见 `ADR-003-sync-core.md`。
- API 目前只覆盖第一条垂直链路的部分资源与同步操作；未完成课程信息普通 REST、学期、提醒及完整同步接口。
- 真实 Supabase 项目、独立 PostgreSQL 服务与 HTTPS 部署尚未集成验证。
