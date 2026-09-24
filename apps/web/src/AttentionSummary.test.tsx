import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { AttentionSummary } from "./AttentionSummary.js";

it("exposes a compact count and disclosure state for attention records", () => {
  const markup = renderToStaticMarkup(
    <AttentionSummary
      eyebrow="NEEDS CONTEXT"
      title="待确认的记录"
      description="逐条处理，不影响继续记录。"
      count={3}
      expanded={false}
      tone="ambiguity"
      onToggle={() => undefined}
    />,
  );
  expect(markup).toContain('aria-expanded="false"');
  expect(markup).toContain('aria-label="3 条"');
  expect(markup).toContain("逐条处理，不影响继续记录。");
});
