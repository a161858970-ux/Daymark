import { expect, it } from "vitest";
import { ChatCompletionsCourseImportParser } from "./course-import-chat-parser.js";

// Minimal one-page PDF containing "Environment Econ Wed 14:00-15:40 Wk1-13 Room101".
const pdfFixture =
  "JVBERi0xLjcKJcK1wrYKJSBXcml0dGVuIGJ5IE11UERGIDEuMjguMgoKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFIvSW5mbzw8L1Byb2R1Y2VyKE11UERGIDEuMjguMik+Pj4+CmVuZG9iagoKMiAwIG9iago8PC9UeXBlL1BhZ2VzL0NvdW50IDEvS2lkc1s0IDAgUl0+PgplbmRvYmoKCjMgMCBvYmoKPDwvRm9udDw8L2hlbHYgNSAwIFI+Pj4+CmVuZG9iagoKNCAwIG9iago8PC9UeXBlL1BhZ2UvTWVkaWFCb3hbMCAwIDMwMCAxMjBdL1JvdGF0ZSAwL1Jlc291cmNlcyAzIDAgUi9QYXJlbnQgMiAwIFIvQ29udGVudHNbNiAwIFJdPj4KZW5kb2JqCgo1IDAgb2JqCjw8L1R5cGUvRm9udC9TdWJ0eXBlL1R5cGUxL0Jhc2VGb250L0hlbHZldGljYS9FbmNvZGluZy9XaW5BbnNpRW5jb2Rpbmc+PgplbmRvYmoKCjYgMCBvYmoKPDwvTGVuZ3RoIDExNi9GaWx0ZXIvRmxhdGVEZWNvZGU+PgpzdHJlYW0KeNodjD0KQkEMBvucIjcwP7tZBbEQbOwebPewUN4uFlrYeH6/SJqZCQl96NxJWTDKJrwX7m/aPcfrywqevB5LjdEiDs1ixogt0osJumcxqQ0NxdWL311cbANXcAHn/uH6bw7LPzPScHG69StdOi30A9+RID4KZW5kc3RyZWFtCmVuZG9iagoKeHJlZgowIDcKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDQyIDAwMDAwIG4gCjAwMDAwMDAxMjAgMDAwMDAgbiAKMDAwMDAwMDE3MiAwMDAwMCBuIAowMDAwMDAwMjEzIDAwMDAwIG4gCjAwMDAwMDAzMjAgMDAwMDAgbiAKMDAwMDAwMDQwOSAwMDAwMCBuIAoKdHJhaWxlcgo8PC9TaXplIDcvUm9vdCAxIDAgUi9JRFs8MzU3NDYzQzNBQkMyOEVDMzhCQzJCN0MzQjE3NkMyQjE+PDU5MkM3RjExRDhGMTUzM0ZBMTRBQzA4NzMzRTRERjkwPl0+PgpzdGFydHhyZWYKNTk0CiUlRU9GCg==";

const transportFor = (
  sent: { value: Record<string, unknown> | null },
  status = 200,
) =>
  (async (_url: RequestInfo | URL, init?: RequestInit) => {
    sent.value = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        choices: [
          {
            finish_reason: "stop",
            message: {
              role: "assistant",
              content: JSON.stringify({
                courses: [
                  {
                    name: "环境经济学",
                    instructor: null,
                    schedules: [],
                  },
                ],
              }),
            },
          },
        ],
      }),
      { status },
    );
  }) as typeof fetch;

it("sends an image through the chat-completions structured output request", async () => {
  const sent: { value: Record<string, unknown> | null } = { value: null };
  const parser = new ChatCompletionsCourseImportParser(
    { apiKey: "server-secret", model: "configured-model" },
    transportFor(sent),
  );
  await expect(
    parser.parse({
      sourceType: "IMAGE",
      fileName: "课表.png",
      mediaType: "image/png",
      contentBase64: Buffer.from("fixture").toString("base64"),
    }),
  ).resolves.toMatchObject({ courses: [{ name: "环境经济学" }] });
  expect(sent.value).toMatchObject({
    model: "configured-model",
    messages: [
      { role: "system" },
      {
        role: "user",
        content: [
          { type: "text" },
          {
            type: "image_url",
            image_url: {
              url: expect.stringContaining("data:image/png;base64,"),
            },
          },
        ],
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "course_timetable_import", strict: true },
    },
  });
  expect(JSON.stringify(sent.value)).not.toContain("server-secret");
});

it("extracts PDF page text instead of sending unsupported file input", async () => {
  const sent: { value: Record<string, unknown> | null } = { value: null };
  const parser = new ChatCompletionsCourseImportParser(
    { apiKey: "server-secret", model: "configured-model" },
    transportFor(sent),
  );
  await expect(
    parser.parse({
      sourceType: "PDF",
      fileName: "课程表.pdf",
      mediaType: "application/pdf",
      contentBase64: pdfFixture,
    }),
  ).resolves.toMatchObject({ courses: [{ name: "环境经济学" }] });
  const content = JSON.stringify(sent.value);
  expect(content).toContain("Environment Econ");
  expect(content).not.toContain("input_file");
  expect(content).not.toContain("application/pdf;base64");
});
