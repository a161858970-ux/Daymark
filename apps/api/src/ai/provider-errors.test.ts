import { expect, it } from "vitest";
import {
  ProviderError,
  providerFailure,
  readStructuredResponse,
} from "./chat-provider.js";
import { CloudError } from "../db/cloud.js";

/**
 * Diagnosis used to stop at the classified kind: every wrapper rebuilt a
 * ProviderError/CloudError from scratch, so the original failure (stack,
 * provider message, zod issues) vanished and reproduction was the only way to
 * investigate. The cause must survive classification and stay out of the
 * product-facing message.
 */
it("keeps the original failure as cause on every providerFailure branch", () => {
  const network = new TypeError("fetch failed");
  const wrapped = providerFailure(network);
  expect(wrapped).toBeInstanceOf(ProviderError);
  expect(wrapped.kind).toBe("UNAVAILABLE");
  expect(wrapped.cause).toBe(network);

  const timeout = new Error("operation timed out");
  const timedOut = providerFailure(timeout);
  expect(timedOut.kind).toBe("TIMEOUT");
  expect(timedOut.cause).toBe(timeout);

  const abort = new Error("aborted");
  abort.name = "AbortError";
  expect(providerFailure(abort).cause).toBe(abort);

  expect(providerFailure("boom").cause).toBe("boom");
});

it("returns an existing ProviderError untouched instead of re-wrapping", () => {
  const original = new ProviderError("MALFORMED", 200);
  expect(providerFailure(original)).toBe(original);
});

it("classifies unreadable responses without losing the parsing failure", async () => {
  const rejection = await readStructuredResponse(
    new Response("definitely not json", { status: 200 }),
  ).catch((error: unknown) => error);
  expect(rejection).toBeInstanceOf(ProviderError);
  expect(rejection).toMatchObject({ kind: "UNAVAILABLE" });
  expect(rejection.cause).toBeInstanceOf(Error);
});

it("carries the cause on CloudError while the product message stays clean", () => {
  const cause = new ProviderError("UNAVAILABLE", 503);
  const error = new CloudError(
    "AI_UNAVAILABLE",
    503,
    "Interpretation provider is unavailable",
    {},
    { cause },
  );
  expect(error.cause).toBe(cause);
  expect(error.message).toBe("Interpretation provider is unavailable");
  expect(error.message).not.toMatch(/stack|ProviderError|Error:/);
});
