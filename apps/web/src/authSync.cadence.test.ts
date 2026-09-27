import { expect, it } from "vitest";
import { SYNC_RECHECK_INTERVAL_MS, requestSyncNow } from "./authSync.js";

it("polls for remote changes every 5 seconds (ADR-008)", () => {
  expect(SYNC_RECHECK_INTERVAL_MS).toBe(5_000);
});

it("requestSyncNow never throws, before the loop has started", async () => {
  expect(() => requestSyncNow()).not.toThrow();
  // The outbox read happens asynchronously; a missing IndexedDB must stay
  // swallowed rather than surface as an unhandled rejection.
  await new Promise((resolve) => setTimeout(resolve, 0));
});
