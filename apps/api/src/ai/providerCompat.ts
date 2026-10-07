/**
 * Per-vendor Chat Completions compatibility.
 *
 * MiMo speaks the OpenAI `json_schema` strict extension (server-enforced
 * structure). DeepSeek's Chat endpoint only offers `json_object` — structure
 * then has to be demanded in-message — and exposes a `thinking` switch that
 * should be off for fast structured extraction. Selection is driven by the
 * base URL so switching vendors is pure configuration (`AI_BASE_URL`), with
 * the key staying in `AI_API_KEY`.
 *
 * The default branch must stay byte-compatible with the original payloads:
 * existing MiMo behaviour and its tests depend on it.
 */

export interface ProviderCompat {
  /** `response_format` body field for this vendor. */
  responseFormat(name: string, schema: unknown): Record<string, unknown>;
  /**
   * Extra system-message line for vendors that only guarantee "valid JSON"
   * (DeepSeek can emit whitespace until the token cap without an explicit
   * instruction mentioning JSON). Empty for schema-enforcing vendors.
   */
  jsonInstruction(name: string, schema: unknown): string;
  /** Additional body fields (DeepSeek: disable thinking for speed). */
  extraBody(): Record<string, unknown>;
}

const schemaEnforcing: ProviderCompat = {
  responseFormat: (name, schema) => ({
    type: "json_schema",
    json_schema: { name, strict: true, schema },
  }),
  jsonInstruction: () => "",
  extraBody: () => ({}),
};

const deepseek: ProviderCompat = {
  // Chat Completions offers text|json_object only; json_schema lives on the
  // Responses API (not used here).
  responseFormat: () => ({ type: "json_object" }),
  jsonInstruction: (name, schema) =>
    [
      "Respond with ONLY one JSON object — no markdown fences, no commentary,",
      `no text before or after — validating against this JSON Schema ("${name}"):`,
      JSON.stringify(schema),
    ].join(" "),
  // Non-thinking mode: fastest first-token for structured extraction.
  extraBody: () => ({ thinking: { type: "disabled" } }),
};

export function providerCompatFor(baseUrl?: string): ProviderCompat {
  return /deepseek/i.test(baseUrl ?? "") ? deepseek : schemaEnforcing;
}
