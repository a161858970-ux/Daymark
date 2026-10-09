import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { I18nProvider } from "./i18n/index.js";
import { SelectField, selectedLabel } from "./SelectField.js";

const options = [
  { value: "", label: "无课程" },
  { value: "c1", label: "环境经济学" },
  { value: "c2", label: "计量经济学" },
];

it("renders an in-app listbox trigger instead of a native select", () => {
  const markup = renderToStaticMarkup(
    <I18nProvider>
      <SelectField
        value="c1"
        onChange={() => undefined}
        options={options}
        ariaLabel="课程"
        label="课程"
      />
    </I18nProvider>,
  );
  // The native popup is drawn by the OS and cannot be styled.
  expect(markup).not.toContain("<select");
  expect(markup).not.toContain("<option");
  expect(markup).toContain('aria-haspopup="listbox"');
  expect(markup).toContain('aria-expanded="false"');
  expect(markup).toContain('aria-label="课程"');
  expect(markup).toContain("环境经济学");
  expect(markup).toContain("select-caret");
  // Closed state renders no popup at all.
  expect(markup).not.toContain('role="listbox"');
});

it("keeps ids usable for label-for wiring", () => {
  const markup = renderToStaticMarkup(
    <I18nProvider>
      <SelectField
        id="week-start"
        value=""
        onChange={() => undefined}
        options={options}
        placeholder="请选择"
      />
    </I18nProvider>,
  );
  expect(markup).toContain('id="week-start"');
  // An empty value resolves through the matching "" option (无课程); a value
  // with no matching option would fall back to the placeholder instead.
  expect(markup).toContain("无课程");
});

it("resolves the displayed label for the current value", () => {
  expect(selectedLabel(options, "c2")).toBe("计量经济学");
  expect(selectedLabel(options, "")).toBe("无课程");
  expect(selectedLabel(options, "missing", "请选择")).toBe("请选择");
  expect(selectedLabel([], "", "请选择")).toBe("请选择");
});
