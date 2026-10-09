import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { I18nProvider } from "./i18n/index.js";
import { AttentionSummary } from "./AttentionSummary.js";

it("exposes a compact count and disclosure state for attention records", () => {
  const markup = renderToStaticMarkup(
    <I18nProvider>
      <AttentionSummary
        eyebrow="NEEDS CONTEXT"
        title="待确认的记录"
        description="逐条处理，不影响继续记录。"
        count={3}
        expanded={false}
        tone="ambiguity"
        onToggle={() => undefined}
      />
    </I18nProvider>,
  );
  expect(markup).toContain('aria-expanded="false"');
  expect(markup).toContain('aria-label="3 条记录"');
  expect(markup).toContain("逐条处理，不影响继续记录。");
});
