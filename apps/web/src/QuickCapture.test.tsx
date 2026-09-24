import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { QuickCapture } from "./QuickCapture.js";

it("keeps one morphing capture control with its input mounted", () => {
  const markup = renderToStaticMarkup(
    <QuickCapture onSave={async () => undefined} />,
  );
  expect(markup).toContain('aria-label="快速记录"');
  expect(markup).toContain('aria-label="快速记录内容"');
  expect(markup).toContain('tabindex="-1"');
  expect(markup).toContain('aria-expanded="false"');
  expect(markup).toContain('aria-label="打开快速记录"');
  expect(markup).toContain('class="quick-capture-feedback"');
  expect(markup).toContain('aria-hidden="true"');
});
