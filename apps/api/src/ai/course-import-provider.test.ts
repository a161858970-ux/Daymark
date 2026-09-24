import { expect, it } from "vitest";
import { OpenAICourseImportParser } from "./course-import-provider.js";

it("sends a transient file input through strict structured output", async () => {
  let sent: Record<string, unknown> | null = null;
  const transport = async (_url: RequestInfo | URL, init?: RequestInit) => {
    sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        output: [
          {
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  courses: [
                    {
                      name: "环境经济学",
                      instructor: null,
                      schedules: [],
                    },
                  ],
                }),
              },
            ],
          },
        ],
      }),
      { status: 200 },
    );
  };
  const parser = new OpenAICourseImportParser(
    "server-secret",
    "configured-model",
    transport as typeof fetch,
  );
  await expect(
    parser.parse({
      sourceType: "PDF",
      fileName: "课程表.pdf",
      mediaType: "application/pdf",
      contentBase64: Buffer.from("fixture").toString("base64"),
    }),
  ).resolves.toMatchObject({ courses: [{ name: "环境经济学" }] });
  expect(sent).toMatchObject({
    model: "configured-model",
    store: false,
    input: [
      {
        role: "user",
        content: [
          { type: "input_text" },
          {
            type: "input_file",
            filename: "课程表.pdf",
            file_data: expect.stringContaining("data:application/pdf;base64,"),
          },
        ],
      },
    ],
    text: { format: { type: "json_schema", strict: true } },
  });
  expect(JSON.stringify(sent)).not.toContain("server-secret");
});
