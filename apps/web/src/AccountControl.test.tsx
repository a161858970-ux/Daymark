import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { AccountControl, SyncStateSummary } from "./AccountControl.js";

it("shows a calm local-only state even when account sync is not configured", () => {
  const markup = renderToStaticMarkup(
    <AccountControl
      online
      attentionCount={0}
      status={{ state: "LOCAL_ONLY", checked_at: null }}
    />,
  );
  expect(markup).toContain("仅本机");
  expect(markup).toContain('aria-expanded="false"');
});

it("lets offline and attention states override a stale synced label", () => {
  const offline = renderToStaticMarkup(
    <AccountControl
      online={false}
      attentionCount={0}
      status={{ state: "UP_TO_DATE", checked_at: "2026-09-24T08:00:00Z" }}
    />,
  );
  const attention = renderToStaticMarkup(
    <AccountControl
      online
      attentionCount={2}
      status={{ state: "UP_TO_DATE", checked_at: "2026-09-24T08:00:00Z" }}
    />,
  );
  expect(offline).toContain("当前离线");
  expect(attention).toContain("需要检查");
  expect(attention).toContain('aria-label="2 条需要检查"');
});

it("offers an explicit exit when sync needs attention", () => {
  const markup = renderToStaticMarkup(
    <SyncStateSummary
      state="NEEDS_ATTENTION"
      attentionCount={1}
      lastChecked={null}
      onOpenRepair={() => {}}
    />,
  );
  expect(markup).toContain("需要检查");
  expect(markup).toContain("1 条记录需要处理");
  expect(markup).toContain("查看并处理");

  const calm = renderToStaticMarkup(
    <SyncStateSummary
      state="UP_TO_DATE"
      attentionCount={0}
      lastChecked="2026-09-24 08:00"
    />,
  );
  expect(calm).toContain("已同步");
  expect(calm).not.toContain("查看并处理");
});
