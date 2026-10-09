import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { I18nProvider } from "./i18n/index.js";
import { AppNavigation } from "./AppNavigation.js";

it("exposes the three product spaces and marks only the active destination", () => {
  const markup = renderToStaticMarkup(
    <I18nProvider>
      <AppNavigation
        page="courses"
        onNavigate={() => undefined}
        onSearch={() => undefined}
      />
    </I18nProvider>,
  );
  expect(markup).toContain("事项总览");
  expect(markup).toContain("课程");
  expect(markup).toContain("日程");
  expect(markup).toContain("搜索记录");
  expect(markup.match(/aria-current="page"/g)).toHaveLength(1);
  expect(markup).toContain('class="active" aria-current="page"');
});
