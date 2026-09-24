import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ErrorNotice, TransientFeedback } from "./TransientNotice.js";

describe("transient notices", () => {
  it("keeps Undo as an explicit action in a polite status", () => {
    const markup = renderToStaticMarkup(
      <TransientFeedback
        feedback={{
          id: 1,
          message: "已标记为完成",
          duration: 2200,
          action: async () => undefined,
        }}
        onDismiss={() => undefined}
        onError={() => undefined}
      />,
    );
    expect(markup).toContain('role="status"');
    expect(markup).toContain("已标记为完成");
    expect(markup).toContain("撤销");
  });

  it("presents errors with a stable dismiss action", () => {
    const markup = renderToStaticMarkup(
      <ErrorNotice message="暂时无法保存" onDismiss={() => undefined} />,
    );
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('aria-label="关闭错误"');
  });
});
