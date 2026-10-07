import { describe, expect, it, vi } from "vitest";
import { providerCompatFor } from "./providerCompat.js";
import { ChatCompletionsInterpretationProvider } from "./chat-provider.js";

const sampleSchema = { type: "object", properties: { a: { type: "string" } } };

describe("providerCompatFor", () => {
  it("keeps the original strict json_schema payload for MiMo (default)", () => {
    const compat = providerCompatFor("https://api.xiaomimimo.com/v1");
    expect(compat.responseFormat("demo", sampleSchema)).toEqual({
      type: "json_schema",
      json_schema: { name: "demo", strict: true, schema: sampleSchema },
    });
    expect(compat.jsonInstruction("demo", sampleSchema)).toBe("");
    expect(compat.extraBody()).toEqual({});
  });

  it("defaults to the schema-enforcing vendor without a base URL", () => {
    expect(providerCompatFor().responseFormat("demo", sampleSchema)).toEqual({
      type: "json_schema",
      json_schema: { name: "demo", strict: true, schema: sampleSchema },
    });
  });

  it("selects DeepSeek json_object + in-message schema + thinking off", () => {
    const compat = providerCompatFor("https://api.deepseek.com");
    expect(compat.responseFormat("demo", sampleSchema)).toEqual({
      type: "json_object",
    });
    const instruction = compat.jsonInstruction("demo", sampleSchema);
    expect(instruction).toContain("JSON object");
    expect(instruction).toContain(JSON.stringify(sampleSchema));
    expect(compat.extraBody()).toEqual({ thinking: { type: "disabled" } });
  });

  it("matches the host case-insensitively", () => {
    expect(
      providerCompatFor("https://api.DEEPSEEK.com/v1").extraBody(),
    ).toEqual({ thinking: { type: "disabled" } });
  });
});

describe("ChatCompletionsInterpretationProvider on DeepSeek", () => {
  it("sends json_object, the schema instruction and thinking disabled", async () => {
    const transport = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: "stop",
                message: { content: JSON.stringify({ ok: true }) },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const provider = new ChatCompletionsInterpretationProvider(
      {
        apiKey: "***",
        model: "deepseek-flash",
        baseUrl: "https://api.deepseek.com",
      },
      transport as unknown as typeof fetch,
    );
    await provider.interpret({} as never);
    expect(transport).toHaveBeenCalledTimes(1);
    const [url, init] = transport.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.deepseek.com/chat/completions");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.thinking).toEqual({ type: "disabled" });
    const messages = body.messages as { role: string; content: string }[];
    expect(messages[0]?.content).toContain("JSON object");
    expect(messages[0]?.content).toContain(
      "Interpret one university-course capture",
    );
  });

  it("keeps the untouched MiMo payload on the default vendor", async () => {
    const transport = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: "stop",
                message: { content: "{}" },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const provider = new ChatCompletionsInterpretationProvider(
      { apiKey: "***", model: "mimo-v2.6-pro" },
      transport as unknown as typeof fetch,
    );
    await provider.interpret({} as never);
    const [, init] = transport.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.response_format).toEqual({
      type: "json_schema",
      json_schema: {
        name: "course_capture_interpretation",
        strict: true,
        schema: expect.anything(),
      },
    });
    expect(body.thinking).toBeUndefined();
    const messages = body.messages as { role: string; content: string }[];
    expect(messages[0]?.content).not.toContain("JSON Schema");
  });
});
