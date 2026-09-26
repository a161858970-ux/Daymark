/**
 * Server-side rate limiting for expensive AI endpoints.
 *
 * The spec (`16_API_CONTRACT.md` §22, `14_TECHNICAL_ARCHITECTURE.md` AI
 * Gateway, `18_AI_PIPELINE_SPEC.md`) requires rate limits on AI endpoints but
 * fixes no numbers, so these are **security defaults**, not product behaviour:
 * they are configurable through the environment and never surfaced as product
 * copy beyond a stable `RATE_LIMITED` error.
 *
 * Scope decision: every AI endpoint sits behind JWT authentication, so the
 * bucket key is the authenticated owner. There is no unauthenticated AI
 * surface that would need a separate IP bucket, and deterministic captures
 * never reach this code path, so they consume no quota.
 */

export interface RateLimitOptions {
  /** Requests allowed per window for one key. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Injectable clock, so boundaries are testable. */
  now?: () => number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/** Security defaults: 20 AI calls / owner / minute. Override via env. */
export const DEFAULT_RATE_LIMIT_OPTIONS: RateLimitOptions = {
  limit: 20,
  windowMs: 60_000,
};

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function rateLimitFromEnv(
  env: Record<string, string | undefined> = process.env,
): RateLimitOptions {
  return {
    limit: positiveInt(
      env.AI_RATE_LIMIT_PER_OWNER,
      DEFAULT_RATE_LIMIT_OPTIONS.limit,
    ),
    windowMs: positiveInt(
      env.AI_RATE_LIMIT_WINDOW_MS,
      DEFAULT_RATE_LIMIT_OPTIONS.windowMs,
    ),
  };
}

interface Bucket {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly now: () => number;

  constructor(private readonly options: RateLimitOptions) {
    this.now = options.now ?? Date.now;
  }

  private sweep(current: number): void {
    if (this.buckets.size < 1024) return;
    for (const [key, bucket] of this.buckets)
      if (bucket.resetAt <= current) this.buckets.delete(key);
  }

  /** Fixed window: the Nth call inside the window is still allowed. */
  check(key: string): RateLimitResult {
    const current = this.now();
    this.sweep(current);
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= current) {
      this.buckets.set(key, {
        count: 1,
        resetAt: current + this.options.windowMs,
      });
      return {
        allowed: true,
        remaining: this.options.limit - 1,
        retryAfterSeconds: 0,
      };
    }
    if (bucket.count >= this.options.limit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((bucket.resetAt - current) / 1000),
        ),
      };
    }
    bucket.count += 1;
    return {
      allowed: true,
      remaining: Math.max(0, this.options.limit - bucket.count),
      retryAfterSeconds: 0,
    };
  }

  /** Test/administrative escape hatch; never reachable from a request. */
  reset(key?: string): void {
    if (key) this.buckets.delete(key);
    else this.buckets.clear();
  }
}
