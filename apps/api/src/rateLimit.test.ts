import { expect, it } from "vitest";
import {
  DEFAULT_RATE_LIMIT_OPTIONS,
  RateLimiter,
  rateLimitFromEnv,
} from "./rateLimit.js";

function limiterAt(limit: number, windowMs = 60_000) {
  let now = 0;
  const limiter = new RateLimiter({ limit, windowMs, now: () => now });
  return {
    limiter,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

it("allows exactly the configured number of calls inside a window", () => {
  const { limiter } = limiterAt(3);
  expect(limiter.check("owner:a")).toMatchObject({
    allowed: true,
    remaining: 2,
    retryAfterSeconds: 0,
  });
  expect(limiter.check("owner:a")).toMatchObject({
    allowed: true,
    remaining: 1,
  });
  expect(limiter.check("owner:a")).toMatchObject({
    allowed: true,
    remaining: 0,
  });
  const blocked = limiter.check("owner:a");
  expect(blocked.allowed).toBe(false);
  expect(blocked.remaining).toBe(0);
  expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
});

it("keeps one bucket per key so owners cannot exhaust each other", () => {
  const { limiter } = limiterAt(1);
  expect(limiter.check("owner:a").allowed).toBe(true);
  expect(limiter.check("owner:a").allowed).toBe(false);
  expect(limiter.check("owner:b").allowed).toBe(true);
  expect(limiter.check("owner:c").allowed).toBe(true);
});

it("reports a retry delay that shrinks as the window closes", () => {
  let now = 0;
  const limiter = new RateLimiter({
    limit: 1,
    windowMs: 60_000,
    now: () => now,
  });
  expect(limiter.check("owner:a").allowed).toBe(true);
  expect(limiter.check("owner:a").retryAfterSeconds).toBe(60);
  now += 45_000;
  expect(limiter.check("owner:a").retryAfterSeconds).toBe(15);
  now += 15_000;
  expect(limiter.check("owner:a").allowed).toBe(true);
});

it("reads conservative security defaults from the environment", () => {
  expect(rateLimitFromEnv({})).toEqual(DEFAULT_RATE_LIMIT_OPTIONS);
  expect(
    rateLimitFromEnv({
      AI_RATE_LIMIT_PER_OWNER: "5",
      AI_RATE_LIMIT_WINDOW_MS: "30000",
    }),
  ).toEqual({ limit: 5, windowMs: 30_000 });
  // Invalid values fall back to the security default instead of disabling the limit.
  expect(
    rateLimitFromEnv({
      AI_RATE_LIMIT_PER_OWNER: "0",
      AI_RATE_LIMIT_WINDOW_MS: "-1",
    }),
  ).toEqual(DEFAULT_RATE_LIMIT_OPTIONS);
  expect(rateLimitFromEnv({ AI_RATE_LIMIT_PER_OWNER: "many" })).toEqual(
    DEFAULT_RATE_LIMIT_OPTIONS,
  );
});

it("reset clears a single key without touching the others", () => {
  const { limiter } = limiterAt(1);
  expect(limiter.check("owner:a").allowed).toBe(true);
  expect(limiter.check("owner:a").allowed).toBe(false);
  limiter.reset("owner:a");
  expect(limiter.check("owner:a").allowed).toBe(true);
  expect(limiter.check("owner:b").allowed).toBe(true);
});
