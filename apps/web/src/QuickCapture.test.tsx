import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { I18nProvider } from "./i18n/index.js";
import { QuickCapture } from "./QuickCapture.js";

it("keeps one morphing capture control with its input mounted", () => {
  const markup = renderToStaticMarkup(
    <I18nProvider initialLocale="zh-CN">
      <QuickCapture onSave={async () => undefined} />
    </I18nProvider>,
  );
  expect(markup).toContain('aria-label="快速记录"');
  expect(markup).toContain('aria-label="快速记录内容"');
  expect(markup).toContain('tabindex="-1"');
  expect(markup).toContain('aria-expanded="false"');
  expect(markup).toContain('aria-label="打开快速记录"');
  expect(markup).toContain('class="quick-capture-feedback"');
  expect(markup).toContain('aria-hidden="true"');
});
