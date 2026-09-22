import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import { buildServer } from "../server.js";
import { CloudCourseManager, type CloudDatabase } from "../db/cloud.js";
import {
  CaptureInterpretationService,
  type InterpretationProvider,
} from "./interpretation.js";
import { OpenAIInterpretationProvider } from "./openai-provider.js";

const ownerOne = "11111111-1111-4111-8111-111111111111";
const ownerTwo = "22222222-2222-4222-8222-222222222222";

it("interprets only unresolved captures owned by the caller and never creates Items", async () => {
  const db = new PGlite();
  const migration = fileURLToPath(
    new URL("../../../../backend/migrations/001_initial.sql", import.meta.url),
  );
  await db.exec(await readFile(migration, "utf8"));
  const port: CloudDatabase = {
    query: async (sql, params) => db.query(sql, params),
    transaction: (work) =>
      db.transaction((tx) =>
        work({ query: async (sql, params) => tx.query(sql, params) }),
      ),
  };
  const cloud = new CloudCourseManager(port);
  let calls = 0;
  let providerValue: unknown = null;
  let providerFails = false;
  const provider: InterpretationProvider = {
    interpret: async () => {
      calls++;
      if (providerFails) throw new Error("timeout");
      return providerValue;
    },
  };
  const server = buildServer({
    cloud,
    interpretation: new CaptureInterpretationService(cloud, null, provider),
    verifyToken: async (token) =>
      token === "one" ? ownerOne : token === "two" ? ownerTwo : null,
  });
  const capture = (
    text: string,
    source: "QUICK_CAPTURE" | "COURSE_INFORMATION" = "QUICK_CAPTURE",
  ) =>
    cloud.createRawCapture(ownerOne, randomUUID(), {
      source,
      raw_text: text,
      captured_at: "2026-09-22T08:00:00.000Z",
    });
  const request = (
    id: string,
    token = "one",
    currentCourseId: string | null = null,
  ) =>
    server.inject({
      method: "POST",
      url: "/api/v1/ai/capture-interpretations",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        raw_capture_id: id,
        context: {
          candidate_course_ids: [],
          current_course_id: currentCourseId,
          current_semester_id: null,
        },
      },
    });
  try {
    const course = await cloud.createCourse(ownerOne, randomUUID(), {
      name: "环境经济学",
      semester_id: null,
      instructor: null,
    });
    const clear = await capture("找学姐要笔记");
    expect((await request(clear.id)).json().data).toMatchObject({
      source: "DETERMINISTIC",
      interpretation: { classification: "ITEM", title: "找学姐要笔记" },
    });
    const information = await capture(
      "老师说期末会画重点",
      "COURSE_INFORMATION",
    );
    expect(
      (await request(information.id, "one", course.id)).json().data,
    ).toMatchObject({
      source: "DETERMINISTIC",
      interpretation: {
        classification: "COURSE_INFORMATION",
        course_information: "老师说期末会画重点",
      },
    });
    const multi = await capture("找学姐要笔记，提交报告");
    expect((await request(multi.id)).json().data).toMatchObject({
      source: "DETERMINISTIC",
      requires_confirmation: true,
      interpretation: {
        classification: "MULTI_ITEM_CANDIDATE",
        split_candidates: ["找学姐要笔记", "提交报告"],
      },
    });
    expect(calls).toBe(0);
    expect((await request(clear.id, "two")).statusCode).toBe(404);
    expect((await request(clear.id, "one", randomUUID())).statusCode).toBe(400);

    const ambiguous = await capture("老师让我们关注一下第三章");
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
    providerValue = ambiguousProposal;
    expect((await request(ambiguous.id)).json().data).toMatchObject({
      source: "AI",
      requires_confirmation: true,
      interpretation: { classification: "AMBIGUOUS" },
    });
    providerValue = { classification: "ITEM" };
    expect((await request(ambiguous.id)).json().error.code).toBe(
      "AI_INVALID_OUTPUT",
    );
    providerValue = {
      ...ambiguousProposal,
      classification: "ITEM",
      title: "伪造事实",
    };
    expect((await request(ambiguous.id)).statusCode).toBe(502);
    providerValue = {
      ...ambiguousProposal,
      classification: "ITEM",
      title: ambiguous.raw_text,
      due_at: "2026-10-09T12:00:00.000Z",
    };
    expect((await request(ambiguous.id)).statusCode).toBe(502);
    providerFails = true;
    expect((await request(ambiguous.id)).json().error.code).toBe(
      "AI_UNAVAILABLE",
    );
    expect((await cloud.getRawCapture(ownerOne, ambiguous.id))?.raw_text).toBe(
      "老师让我们关注一下第三章",
    );
    expect((await db.query("SELECT id FROM items")).rows).toHaveLength(0);
    expect(calls).toBe(5);
  } finally {
    await server.close();
    await db.close();
  }
});

it("sends minimal context through a strict structured response request", async () => {
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
                text: JSON.stringify({ classification: "AMBIGUOUS" }),
              },
            ],
          },
        ],
      }),
      { status: 200 },
    );
  };
  const provider = new OpenAIInterpretationProvider(
    "server-secret",
    "configured-model",
    transport as typeof fetch,
  );
  expect(
    await provider.interpret({
      rawText: "老师让我们关注一下第三章",
      source: "QUICK_CAPTURE",
      currentCourseName: null,
      candidateCourseNames: [],
      semesterDates: null,
      currentDate: "2026-09-22",
    }),
  ).toEqual({ classification: "AMBIGUOUS" });
  expect(sent).toMatchObject({
    model: "configured-model",
    store: false,
    text: { format: { type: "json_schema", strict: true } },
  });
  expect(JSON.stringify(sent)).not.toContain("server-secret");
});
