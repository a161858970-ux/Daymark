# ADR-008: Sync cadence and push trigger

- 状态：Accepted（2026-09-27）
- 关联：`docs/ADR-003-sync-core.md`、规格 `14_TECHNICAL_ARCHITECTURE.md` §"离线协调"

## 背景

真实环境验收中，两端各改一个字段后，观察到**约 30 秒**才收敛（一次完整链路 = 发送端等自己的轮询 + 接收端等自己的轮询，最坏 ≈ 两倍间隔）。

规格只写「离线情况下无法做到数学意义上的跨设备实时；因此系统应采用……」，**没有规定任何秒数**，因此这是工程参数而非产品行为，可以在不改产品语义的前提下调整。

原实现的全部触发点：30 s 定时、`focus`、`online`、登录态变化、页面启动、手动「立即核对」。**本地保存后不会立即推送**。

## 决定

1. **本地写后立即推送（A）**：`requestSyncNow()` 在每次 `refresh()` 后调用，**仅当 outbox 真有待推送变更时**才触发一轮，普通界面刷新不产生请求。
2. **轮询间隔 30 s → 5 s（B）**：`SYNC_RECHECK_INTERVAL_MS = 5_000`。
3. **新增 `visibilitychange` 触发**：标签页重新可见时立刻核对一次（浏览器会把后台标签页的 `setInterval` 节流到约 1 次/分钟，回到前台时需要补一次）。

保留 `activeRun` 防重入：进行中的那一轮不会被并发触发，未推送的变更由 5 s 兜底轮次接住。

## 代价

- 请求量：每设备每分钟约 12 次轮询（每次 = push/changes/conflicts 各一次 HTTP + 若干索引查询）；只在有本地改动时额外触发推送。
- 移动端耗电略增；仍在免费额度内数个量级以下。
- 后台标签页依旧受浏览器节流，**后台执行仍属于未完成的 release gate**（service worker / 平台通知）。

## 未选择的方案

- **Supabase Realtime / SSE / WebSocket**：<1 s 双向，但引入新基础设施、断线重连与心跳管理，超出当前规格范围，留作发布后增强。

## 验证

- `apps/web/src/authSync.cadence.test.ts`：轮询间隔契约 + `requestSyncNow` 在未启动时惰性且不抛错。
- 真实环境体感验收（两端改不同字段 → 自动合并 → 无需人工干预）：见 `docs/FINAL_RELEASE_VALIDATION.md` C5。
