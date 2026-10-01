import { renderToStaticMarkup } from "react-dom/server";
import { DateTimeField } from "./src/DateTimeField.js";
const markup = renderToStaticMarkup(
  DateTimeField({
    mode: "datetime",
    label: "开始时间",
    ariaLabel: "开始时间",
    required: true,
    value: "2026-10-01T15:42",
    onChange: () => {},
  }),
);
console.log(markup.slice(0, 600));
