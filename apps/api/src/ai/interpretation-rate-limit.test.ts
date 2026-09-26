import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import { buildServer } from "../server.js";
import { CloudCourseManager, type CloudDatabase } from "../db/cloud.js";
import { RateLimiter } from "../rateLimit.js";
import {
  CaptureInterpretationService,
  type InterpretationProvider,
} from "./interpretation.js";

const ownerOne = "11111111-1111-4111-8111-111111111111";
const ownerTwo = "22222222-2222-4222-8222-222222222222";

const ambiguousProposal = {
  classification: "AMBIGUOUS",
  title: null,
  detail: null,
  course_candidate: null,
  start_at: null,
  occurrence_start_at: null,
  occurrence_end_at: null,
  due_at: null,
  course_information: null,
  split_candidates: [],
  confidence: 0.5,
  uncertainty: "是否需要行动，等待用户确认",
};

async function harness(limit: number) {
  const db = new PGlite();
  await db.exec(
    await readFile(
      fileURLToPath(
        new URL(
          "../../../../backend/migrations/001_initial.sql",
          import.meta.url,
        ),
      ),
      "utf8",
    ),
  );
  const port: CloudDatabase = {
    query: async (sql, params) => db.query(sql, params),
    transaction: (work) =>
      db.transaction((tx) =>
        work({ query: async (sql, params) => tx.query(sql, params) }),
      ),
  };
  const cloud = new CloudCourseManager(port);
  let providerCalls = 0;
  const provider: InterpretationProvider = {
    interpret: async () => {
      providerCalls += 1;
      return ambiguousProposal;
    },
  };
  const limiter = new RateLimiter({ limit, windowMs: 60_000 });
  const server = buildServer({
    cloud,
    interpretation: new CaptureInterpretationService(
      cloud,
      null,
      provider,
      limiter,
    ),
    verifyToken: async (token) =>
      token === "one" ? ownerOne : token === "two" ? ownerTwo : null,
  });
  const capture = (owner: string, text: string) =>
    cloud.createRawCapture(owner, randomUUID(), {
      source: "QUICK_CAPTURE",
      raw_text: text,
      captured_at: "2026-09-22T08:00:00.000Z",
    });
  const request = (id: string, token = "one") =>
    server.inject({
      method: "POST",
      url: "/api/v1/ai/capture-interpretations",
      headers: { authorization: ["Bearer", token].join(" ") },
      payload: {
        raw_capture_id: id,
        context: {
          candidate_course_ids: [],
          current_course_id: null,
          current_semester_id: null,
        },
      },
    });
  return {
    db,
    cloud,
    server,
    limiter,
    capture,
    request,
    calls: () => providerCalls,
  };
}

it("charges AI quota only when the provider runs and stops at the boundary", async () => {
  const harnessInstance = await harness(2);
  const { db, cloud, server, capture, request, calls } = harnessInstance;
  try {
    // Deterministic captures never reach the provider, so they consume no AI quota.
    const clear = await capture(ownerOne, "找学姐要笔记");
    for (let attempt = 0; attempt < 5; attempt++) {
      const response = await request(clear.id);
      expect(response.statusCode).toBe(200);
      expect(response.json().data.source).toBe("DETERMINISTIC");
    }
    expect(calls()).toBe(0);

    // Boundary: the first two AI calls pass, the third is limited.
    const ambiguous = await capture(ownerOne, "老师让我们关注一下第三章");
    expect((await request(ambiguous.id)).statusCode).toBe(200);
    expect((await request(ambiguous.id)).statusCode).toBe(200);
    expect(calls()).toBe(2);

    const limited = await request(ambiguous.id);
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe("RATE_LIMITED");
    expect(limited.json().error.message).toBe("请求过于频繁，请稍后再试。");
    expect(limited.headers["retry-after"]).toBeDefined();
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
    // The response never exposes the implementation.
    expect(JSON.stringify(limited.json())).not.toMatch(
      /bucket|limiter|window|RateLimiter/i,
    );
    expect(calls()).toBe(2);

    // A rejected attempt leaves the RawCapture intact and creates no Item.
    expect((await cloud.getRawCapture(ownerOne, ambiguous.id))?.raw_text).toBe(
      "老师让我们关注一下第三章",
    );
    expect((await cloud.listItems()).data).toHaveLength(0);

    // Another owner keeps its own bucket.
    const other = await capture(ownerTwo, "老师让我们关注一下第三章");
    expect((await request(other.id, "two")).statusCode).toBe(200);
    expect(calls()).toBe(3);
  } finally {
    await server.close();
    await db.close();
  }
});

it("re-opens the window after it elapses", async () => {
  let now = 1_000_000;
  const limiter = new RateLimiter({
    limit: 1,
    windowMs: 60_000,
    now: () => now,
  });
  expect(limiter.check("owner:x").allowed).toBe(true);
  const blocked = limiter.check("owner:x");
  expect(blocked.allowed).toBe(false);
  expect(blocked.retryAfterSeconds).toBe(60);
  now += 60_000;
  expect(limiter.check("owner:x").allowed).toBe(true);
});
