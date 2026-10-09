import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "./i18n/index.js";
import { ErrorNotice, TransientFeedback } from "./TransientNotice.js";

describe("transient notices", () => {
  it("keeps Undo as an explicit action in a polite status", () => {
    const markup = renderToStaticMarkup(
      <I18nProvider>
        <TransientFeedback
          feedback={{
            id: 1,
            message: "已标记为完成",
            duration: 2200,
            action: async () => undefined,
          }}
          onDismiss={() => undefined}
          onError={() => undefined}
        />
      </I18nProvider>,
    );
    expect(markup).toContain('role="status"');
    expect(markup).toContain("已标记为完成");
    expect(markup).toContain("撤销");
  });

  it("presents errors with a stable dismiss action", () => {
    const markup = renderToStaticMarkup(
      <I18nProvider>
        <ErrorNotice message="暂时无法保存" onDismiss={() => undefined} />
      </I18nProvider>,
    );
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('aria-label="关闭"');
  });
});
