import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { ChatCompletionsCourseImportParser } from "./course-import-chat-parser.js";
import { ProviderError } from "./chat-provider.js";

async function fixture(name: string): Promise<string> {
  const path = fileURLToPath(
    new URL(`./__fixtures__/${name}`, import.meta.url),
  );
  return (await readFile(path)).toString("base64");
}

const successBody = {
  choices: [
    {
      finish_reason: "stop",
      message: {
        role: "assistant",
        content: JSON.stringify({
          courses: [{ name: "环境经济学", instructor: null, schedules: [] }],
        }),
      },
    },
  ],
};

const config = { apiKey: "server-secret", model: "configured-model" };

function recorder(responses: (Response | Error)[]) {
  const calls: Record<string, unknown>[] = [];
  let index = 0;
  const transport = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    const next = responses[Math.min(index, responses.length - 1)]!;
    index += 1;
    if (next instanceof Error) throw next;
    return next.clone();
  }) as unknown as typeof fetch;
  return { calls, transport };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

it("sends an image through the chat-completions structured output request", async () => {
  const { calls, transport } = recorder([json(successBody)]);
  const parser = new ChatCompletionsCourseImportParser(config, transport);
  await expect(
    parser.parse({
      sourceType: "IMAGE",
      fileName: "课表.png",
      mediaType: "image/png",
      contentBase64: Buffer.from("fixture").toString("base64"),
    }),
  ).resolves.toMatchObject({ courses: [{ name: "环境经济学" }] });
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({
    model: "configured-model",
    response_format: {
      type: "json_schema",
      json_schema: { name: "course_timetable_import", strict: true },
    },
  });
  const content = JSON.stringify(calls[0]);
  expect(content).toContain("data:image/png;base64,");
  expect(content).not.toContain("server-secret");
});

it("keeps text PDFs on the text path", async () => {
  const { calls, transport } = recorder([json(successBody)]);
  const parser = new ChatCompletionsCourseImportParser(config, transport);
  await parser.parse({
    sourceType: "PDF",
    fileName: "课程表.pdf",
    mediaType: "application/pdf",
    contentBase64: await fixture("text-timetable.pdf"),
  });
  expect(calls).toHaveLength(1);
  const content = JSON.stringify(calls[0]);
  expect(content).toContain("PDF content:");
  expect(content).toContain("Environmental Economics");
  expect(content).not.toContain("data:image/");
});

it("sends a scanned PDF as bounded page images", async () => {
  const { calls, transport } = recorder([json(successBody)]);
  const parser = new ChatCompletionsCourseImportParser(config, transport);
  await parser.parse({
    sourceType: "PDF",
    fileName: "扫描版课程表.pdf",
    mediaType: "application/pdf",
    contentBase64: await fixture("scanned-timetable.pdf"),
  });
  expect(calls).toHaveLength(1);
  const content = JSON.stringify(calls[0]);
  expect(content).toContain("data:image/jpeg;base64,");
  expect(content).not.toContain("data:application/pdf;base64,");
  expect(content.match(/data:image\/jpeg/g)).toHaveLength(2);
  // The original PDF bytes never travel as file input.
  expect(content).not.toContain("input_file");
});

it("retries a transient provider failure exactly once and returns one preview", async () => {
  const { calls, transport } = recorder([
    json({ error: { message: "upstream" } }, 500),
    json(successBody),
  ]);
  const parser = new ChatCompletionsCourseImportParser(config, transport);
  await expect(
    parser.parse({
      sourceType: "IMAGE",
      fileName: "课表.png",
      mediaType: "image/png",
      contentBase64: Buffer.from("fixture").toString("base64"),
    }),
  ).resolves.toMatchObject({ courses: [{ name: "环境经济学" }] });
  expect(calls).toHaveLength(2);
});

it("does not retry an authentication failure", async () => {
  const { calls, transport } = recorder([
    json({ error: { message: "bad key" } }, 401),
  ]);
  const parser = new ChatCompletionsCourseImportParser(config, transport);
  await expect(
    parser.parse({
      sourceType: "IMAGE",
      fileName: "课表.png",
      mediaType: "image/png",
      contentBase64: Buffer.from("fixture").toString("base64"),
    }),
  ).rejects.toMatchObject({ name: "ProviderError", kind: "AUTH" });
  expect(calls).toHaveLength(1);
});

it("classifies timeouts and malformed responses", async () => {
  const timeout = recorder([
    Object.assign(new Error("The operation timed out"), {
      name: "TimeoutError",
    }),
    Object.assign(new Error("The operation timed out"), {
      name: "TimeoutError",
    }),
  ]);
  const parser = new ChatCompletionsCourseImportParser(
    config,
    timeout.transport,
  );
  await expect(
    parser.parse({
      sourceType: "IMAGE",
      fileName: "课表.png",
      mediaType: "image/png",
      contentBase64: Buffer.from("fixture").toString("base64"),
    }),
  ).rejects.toBeInstanceOf(ProviderError);
  expect(timeout.calls).toHaveLength(2);

  const malformed = recorder([new Response("not json", { status: 200 })]);
  const strict = new ChatCompletionsCourseImportParser(
    config,
    malformed.transport,
  );
  await expect(
    strict.parse({
      sourceType: "IMAGE",
      fileName: "课表.png",
      mediaType: "image/png",
      contentBase64: Buffer.from("fixture").toString("base64"),
    }),
  ).rejects.toMatchObject({ kind: "MALFORMED" });
  expect(malformed.calls).toHaveLength(1);
});
