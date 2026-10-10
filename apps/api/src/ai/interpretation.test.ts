import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import { buildServer } from "../server.js";
import { CloudDaymark, type CloudDatabase } from "../db/cloud.js";
import {
  CaptureInterpretationService,
  type InterpretationProvider,
} from "./interpretation.js";
import { ChatCompletionsInterpretationProvider } from "./chat-provider.js";
import { CloudAcademicManager } from "../db/academic.js";

const ownerOne = "11111111-1111-4111-8111-111111111111";
const ownerTwo = "22222222-2222-4222-8222-222222222222";

it("interprets only unresolved captures owned by the caller and never creates Items", async () => {
  const db = new PGlite();
  const migration = fileURLToPath(
    new URL("../../../../backend/migrations/001_initial.sql", import.meta.url),
  );
  await db.exec(await readFile(migration, "utf8"));
  const datePrecisionMigration = fileURLToPath(
    new URL(
      "../../../../backend/migrations/007_date_precision.sql",
      import.meta.url,
    ),
  );
  await db.exec(await readFile(datePrecisionMigration, "utf8"));
  const port: CloudDatabase = {
    query: async (sql, params) => db.query(sql, params),
    transaction: (work) =>
      db.transaction((tx) =>
        work({ query: async (sql, params) => tx.query(sql, params) }),
      ),
  };
  const cloud = new CloudDaymark(port);
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
      captured_tz: "Asia/Shanghai",
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
      start_date: null,
      occurrence_start_at: null,
      occurrence_start_date: null,
      occurrence_end_at: null,
      occurrence_end_date: null,
      due_at: null,
      due_date: null,
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
    const logged: string[] = [];
    const previousConsoleError = console.error;
    console.error = (...args: unknown[]) => {
      logged.push(args.map((value) => String(value)).join(" "));
    };
    let failed: { error: { code: string; message: string } };
    try {
      failed = (await request(ambiguous.id)).json();
    } finally {
      console.error = previousConsoleError;
    }
    expect(failed.error.code).toBe("AI_UNAVAILABLE");
    // The engineering reason reaches the API log (stderr) for diagnosis...
    expect(logged.join("\n")).toContain("timeout");
    // ...while the response keeps product-level language.
    expect(failed.error.message).not.toContain("timeout");
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

it("never invents relative dates for historical captures without captured_tz", async () => {
  const db = new PGlite();
  const migration = fileURLToPath(
    new URL("../../../../backend/migrations/001_initial.sql", import.meta.url),
  );
  await db.exec(await readFile(migration, "utf8"));
  await db.exec(
    await readFile(
      fileURLToPath(
        new URL(
          "../../../../backend/migrations/007_date_precision.sql",
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
  const cloud = new CloudDaymark(port);
  let seen: {
    captureLocalDate: string | null;
    capturedTimeZone: string | null;
    capturedAt: string;
  } | null = null;
  const provider: InterpretationProvider = {
    interpret: async (input) => {
      seen = {
        captureLocalDate: input.captureLocalDate,
        capturedTimeZone: input.capturedTimeZone,
        capturedAt: input.capturedAt,
      };
      return {
        classification: "AMBIGUOUS",
        title: null,
        detail: null,
        course_candidate: null,
        start_at: null,
        start_date: null,
        occurrence_start_at: null,
        occurrence_start_date: null,
        occurrence_end_at: null,
        occurrence_end_date: null,
        due_at: null,
        due_date: null,
        course_information: null,
        split_candidates: [],
        confidence: 0.4,
        uncertainty: "缺少捕获时区，相对日期无法确认",
      };
    },
  };
  const server = buildServer({
    cloud,
    interpretation: new CaptureInterpretationService(cloud, null, provider),
    verifyToken: async (token) => (token === "one" ? ownerOne : null),
  });
  try {
    // Clear type + relative time, no tz → deterministic ITEM with null dates.
    const clear = await cloud.createRawCapture(ownerOne, randomUUID(), {
      source: "QUICK_CAPTURE",
      raw_text: "明天下午3点交报告",
      captured_at: "2026-10-09T02:00:00.000Z",
      captured_tz: null,
    });
    const clearBody = (
      await server.inject({
        method: "POST",
        url: "/api/v1/ai/capture-interpretations",
        headers: { authorization: "Bearer one" },
        payload: {
          raw_capture_id: clear.id,
          context: {
            candidate_course_ids: [],
            current_course_id: null,
            current_semester_id: null,
          },
        },
      })
    ).json();
    expect(clearBody.data.source).toBe("DETERMINISTIC");
    expect(clearBody.data.interpretation.classification).toBe("ITEM");
    expect(clearBody.data.interpretation.due_at).toBeNull();
    expect(clearBody.data.interpretation.due_date).toBeNull();
    expect(seen).toBeNull();

    // Ambiguous + relative time, no tz → AI sees captureLocalDate=null.
    const ambiguous = await cloud.createRawCapture(ownerOne, randomUUID(), {
      source: "QUICK_CAPTURE",
      raw_text: "老师让我们关注一下第三章，明天再说",
      captured_at: "2026-10-09T02:00:00.000Z",
      captured_tz: null,
    });
    const response = await server.inject({
      method: "POST",
      url: "/api/v1/ai/capture-interpretations",
      headers: { authorization: "Bearer one" },
      payload: {
        raw_capture_id: ambiguous.id,
        context: {
          candidate_course_ids: [],
          current_course_id: null,
          current_semester_id: null,
        },
      },
    });
    const body = response.json();
    expect(body, JSON.stringify(body)).toHaveProperty("data");
    expect(body.data.source).toBe("AI");
    expect(seen).toMatchObject({
      captureLocalDate: null,
      capturedTimeZone: null,
    });
    expect(String((seen as { capturedAt: string }).capturedAt)).toContain(
      "2026-10-09",
    );
    const proposal = body.data.interpretation;
    expect(proposal.due_at).toBeNull();
    expect(proposal.due_date).toBeNull();
    expect(proposal.start_date).toBeNull();
    expect((await cloud.getRawCapture(ownerOne, ambiguous.id))?.raw_text).toBe(
      "老师让我们关注一下第三章，明天再说",
    );
    expect((await db.query("SELECT id FROM items")).rows).toHaveLength(0);
  } finally {
    await server.close();
    await db.close();
  }
});

it("sends minimal context through a strict structured response request", async () => {
  let sent: Record<string, unknown> | null = null;
  let endpoint = "";
  let headers: Record<string, string> = {};
  const transport = async (url: RequestInfo | URL, init?: RequestInit) => {
    endpoint = String(url);
    headers = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>).map(
        ([key, value]) => [key.toLowerCase(), String(value)],
      ),
    );
    sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        choices: [
          {
            finish_reason: "stop",
            message: {
              role: "assistant",
              content: JSON.stringify({ classification: "AMBIGUOUS" }),
            },
          },
        ],
      }),
      { status: 200 },
    );
  };
  const provider = new ChatCompletionsInterpretationProvider(
    {
      apiKey: "server-secret",
      model: "configured-model",
      baseUrl: "https://chat.example.test/v1",
    },
    transport as typeof fetch,
  );
  expect(
    await provider.interpret({
      rawText: "老师让我们关注一下第三章",
      source: "QUICK_CAPTURE",
      currentCourseName: null,
      candidateCourseNames: [],
      semesterDates: null,
      capturedAt: "2026-09-22T08:00:00Z",
      capturedTimeZone: "UTC",
      captureLocalDate: "2026-09-22",
    }),
  ).toEqual({ classification: "AMBIGUOUS" });
  expect(endpoint).toBe("https://chat.example.test/v1/chat/completions");
  expect(headers.authorization).toMatch(/^Bearer /);
  expect(sent).toMatchObject({
    model: "configured-model",
    messages: [{ role: "system" }, { role: "user" }],
    response_format: {
      type: "json_schema",
      json_schema: { name: "course_capture_interpretation", strict: true },
    },
  });
  expect(JSON.stringify(sent)).not.toContain("server-secret");
});

async function setupAiHarness() {
  const db = new PGlite();
  const migration = fileURLToPath(
    new URL("../../../../backend/migrations/001_initial.sql", import.meta.url),
  );
  await db.exec(await readFile(migration, "utf8"));
  await db.exec(
    await readFile(
      fileURLToPath(
        new URL(
          "../../../../backend/migrations/007_date_precision.sql",
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
  const cloud = new CloudDaymark(port);
  const academic = new CloudAcademicManager(port);
  let providerValue: unknown = null;
  const provider: InterpretationProvider = {
    interpret: async () => providerValue,
  };
  const server = buildServer({
    cloud,
    interpretation: new CaptureInterpretationService(cloud, academic, provider),
    verifyToken: async (token) => (token === "one" ? ownerOne : null),
  });
  return {
    db,
    cloud,
    academic,
    server,
    setProviderValue: (value: unknown) => {
      providerValue = value;
    },
  };
}

function proposalFor(
  rawText: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    classification: "ITEM",
    title: rawText,
    detail: null,
    course_candidate: null,
    start_at: null,
    start_date: null,
    occurrence_start_at: null,
    occurrence_start_date: null,
    occurrence_end_at: null,
    occurrence_end_date: null,
    due_at: null,
    due_date: null,
    course_information: null,
    split_candidates: [],
    confidence: 0.5,
    uncertainty: null,
    ...overrides,
  };
}

it("blocks AI time values that only come from relative phrases when captured_tz is missing", async () => {
  const { db, cloud, server, setProviderValue } = await setupAiHarness();
  try {
    const rawText = "老师让我们关注一下第三章，明天再说";
    const historical = await cloud.createRawCapture(ownerOne, randomUUID(), {
      source: "QUICK_CAPTURE",
      raw_text: rawText,
      captured_at: "2026-10-09T02:00:00.000Z",
      captured_tz: null,
    });
    const request = () =>
      server.inject({
        method: "POST",
        url: "/api/v1/ai/capture-interpretations",
        headers: { authorization: "Bearer one" },
        payload: {
          raw_capture_id: historical.id,
          context: {
            candidate_course_ids: [],
            current_course_id: null,
            current_semester_id: null,
          },
        },
      });
    // Adversarial: the provider deliberately violates the prompt and returns
    // concrete values derived from 明天 (capture day 2026-10-09 → 10-10)
    // although there is no captured_tz to anchor them. The server must refuse
    // even though the model misbehaves.
    for (const violation of [
      { due_date: "2026-10-10" },
      { due_at: "2026-10-10T07:00:00.000Z" },
      { occurrence_start_date: "2026-10-10" },
      { occurrence_start_at: "2026-10-10T07:00:00.000Z" },
      { start_date: "2026-10-10" },
    ]) {
      setProviderValue(proposalFor(rawText, violation));
      const response = await request();
      expect(response.statusCode, JSON.stringify(violation)).toBe(502);
      expect(response.json().error.code).toBe("AI_INVALID_OUTPUT");
    }
    // A compliant suggestion that keeps the temporal phrase in the text is
    // still a valid, reviewable proposal.
    setProviderValue(proposalFor(rawText));
    const compliant = await request();
    expect(compliant.statusCode).toBe(200);
    expect(compliant.json().data).toMatchObject({
      source: "AI",
      requires_confirmation: true,
      interpretation: { due_date: null, due_at: null, start_date: null },
    });
    // The raw text is never rewritten and no formal object is auto-created.
    expect((await cloud.getRawCapture(ownerOne, historical.id))?.raw_text).toBe(
      rawText,
    );
    expect((await db.query("SELECT id FROM items")).rows).toHaveLength(0);
  } finally {
    await server.close();
    await db.close();
  }
});

it("keeps anchored dates valid: full Y-M-D, semester-completed years and capture-local relative days", async () => {
  const { db, cloud, academic, server, setProviderValue } =
    await setupAiHarness();
  try {
    const request = (id: string, semesterId: string | null = null) =>
      server.inject({
        method: "POST",
        url: "/api/v1/ai/capture-interpretations",
        headers: { authorization: "Bearer one" },
        payload: {
          raw_capture_id: id,
          context: {
            candidate_course_ids: [],
            current_course_id: null,
            current_semester_id: semesterId,
          },
        },
      });

    // (1) A user-written full date is anchored even without captured_tz and
    // even when a relative phrase is also present.
    const datedText = "老师让我们关注一下第三章，2026年10月15日交，明天再说";
    const dated = await cloud.createRawCapture(ownerOne, randomUUID(), {
      source: "QUICK_CAPTURE",
      raw_text: datedText,
      captured_at: "2026-10-09T02:00:00.000Z",
      captured_tz: null,
    });
    setProviderValue(proposalFor(datedText, { due_date: "2026-10-15" }));
    const fullDate = await request(dated.id);
    expect(fullDate.statusCode, JSON.stringify(fullDate.json())).toBe(200);
    expect(fullDate.json().data.interpretation.due_date).toBe("2026-10-15");

    // (2) Year-less completion is kept only with reliable semester context.
    const semester = await academic.createSemester(ownerOne, randomUUID(), {
      name: "2026秋季学期",
      start_date: "2026-09-01",
      end_date: "2027-01-15",
    });
    const yearlessText = "老师让我们关注一下第三章，10.12交，明天再说";
    const yearless = await cloud.createRawCapture(ownerOne, randomUUID(), {
      source: "QUICK_CAPTURE",
      raw_text: yearlessText,
      captured_at: "2026-10-09T02:00:00.000Z",
      captured_tz: null,
    });
    setProviderValue(proposalFor(yearlessText, { due_date: "2026-10-12" }));
    // Without semester context the year would be a guess → blocked.
    expect((await request(yearless.id)).statusCode).toBe(502);
    // With the semester context the approved completion rule allows it.
    const semesterBacked = await request(yearless.id, semester.id);
    expect(
      semesterBacked.statusCode,
      JSON.stringify(semesterBacked.json()),
    ).toBe(200);
    expect(semesterBacked.json().data.interpretation.due_date).toBe(
      "2026-10-12",
    );

    // (3) With captured_tz the relative day is anchored to the capture-local
    // day (2026-10-09 Asia/Shanghai → 明天 = 2026-10-10) and stays valid.
    const zonedText = "老师让我们关注一下第三章，明天再说";
    const zoned = await cloud.createRawCapture(ownerOne, randomUUID(), {
      source: "QUICK_CAPTURE",
      raw_text: zonedText,
      captured_at: "2026-10-09T02:00:00.000Z",
      captured_tz: "Asia/Shanghai",
    });
    setProviderValue(proposalFor(zonedText, { due_date: "2026-10-10" }));
    const relative = await request(zoned.id);
    expect(relative.statusCode, JSON.stringify(relative.json())).toBe(200);
    expect(relative.json().data.interpretation.due_date).toBe("2026-10-10");

    // AI results are review suggestions only: nothing formal was created.
    expect((await db.query("SELECT id FROM items")).rows).toHaveLength(0);
  } finally {
    await server.close();
    await db.close();
  }
});
