import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import { buildServer } from "../server.js";
import { CloudAcademicManager } from "./academic.js";
import {
  CloudCourseImportManager,
  importFailureMessage,
  type CourseImportParser,
} from "./course-import.js";
import { CloudDaymark, type CloudDatabase } from "./cloud.js";
import { ProviderError } from "../ai/chat-provider.js";
import { CourseImportParseError } from "../ai/pdf-source.js";
import { RateLimiter } from "../rateLimit.js";

const owner = "11111111-1111-4111-8111-111111111111";
const otherOwner = "22222222-2222-4222-8222-222222222222";

async function harness(parser: CourseImportParser, limiter?: RateLimiter) {
  const postgres = new PGlite();
  for (const name of [
    "001_initial.sql",
    "002_collection_sync.sql",
    "003_course_import.sql",
    "005_schedule_times_nullable.sql",
    "006_course_import_parse_cache.sql",
    "007_date_precision.sql",
  ]) {
    const path = fileURLToPath(
      new URL(`../../../../backend/migrations/${name}`, import.meta.url),
    );
    await postgres.exec(await readFile(path, "utf8"));
  }
  const database: CloudDatabase = {
    query: async (sql, params) => postgres.query(sql, params),
    transaction: (work) =>
      postgres.transaction((transaction) =>
        work({
          query: async (sql, params) => transaction.query(sql, params),
        }),
      ),
  };
  const cloud = new CloudDaymark(database);
  const academic = new CloudAcademicManager(database);
  const imports = new CloudCourseImportManager(
    database,
    parser,
    limiter ?? null,
  );
  const server = buildServer({
    cloud,
    academic,
    courseImports: imports,
    verifyToken: async (token) =>
      token === "owner" ? owner : token === "other" ? otherOwner : null,
  });
  return { postgres, database, cloud, academic, imports, server };
}

function request(
  server: Awaited<ReturnType<typeof harness>>["server"],
  method: "GET" | "POST" | "DELETE",
  url: string,
  payload?: object,
  token = "owner",
  idempotencyKey?: string,
) {
  return server.inject({
    method,
    url,
    headers: {
      authorization: `Bearer ${token}`,
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
    },
    payload,
  });
}

const parsedCourses = {
  courses: [
    {
      name: "环境经济学",
      instructor: "林老师",
      schedules: [
        {
          weekday: 2,
          start_time: "09:00",
          end_time: "10:30",
          week_start: 1,
          week_end: 14,
          classroom: "A101",
          stage_label: null,
        },
      ],
    },
    {
      name: "经济法",
      instructor: null,
      schedules: [
        {
          weekday: 4,
          start_time: "14:00",
          end_time: "15:30",
          week_start: null,
          week_end: null,
          classroom: null,
          stage_label: "后半学期",
        },
      ],
    },
  ],
};

it("imports a persisted preview atomically, requires duplicate decisions, and deduplicates re-import", async () => {
  const parser: CourseImportParser = { parse: async () => parsedCourses };
  const { postgres, database, cloud, academic, server } = await harness(parser);
  try {
    const previous = await academic.createSemester(owner, randomUUID(), {
      name: "2026 春季学期",
      start_date: "2026-02-01",
      end_date: "2026-06-30",
    });
    const current = await academic.createSemester(owner, randomUUID(), {
      name: "2026 秋季学期",
      start_date: "2026-09-01",
      end_date: "2026-12-31",
    });
    const priorCourse = await cloud.createCourse(owner, randomUUID(), {
      name: "环境经济学",
      semester_id: previous.id,
      instructor: "旧教师",
    });
    await cloud.createCourseInformation(
      owner,
      priorCourse.id,
      randomUUID(),
      "教材是第四版",
    );
    await academic.replaceSchedules(owner, priorCourse.id, randomUUID(), [
      {
        weekday: 1,
        start_time: "08:00",
        end_time: "09:30",
        week_start: 1,
        week_end: 12,
        classroom: "旧教室",
        stage_label: null,
      },
    ]);
    const historicalItem = await cloud.createItem(owner, randomUUID(), {
      title: "历史作业",
      detail: null,
      course_id: priorCourse.id,
      status: "INCOMPLETE",
      start_at: null,
      start_date: null,
      occurrence_start_at: null,
      occurrence_start_date: null,
      occurrence_end_at: null,
      occurrence_end_date: null,
      due_at: null,
      due_date: null,
      time_zone: "UTC",
      reminder_level: "NORMAL",
      raw_capture_id: null,
    });

    const startedResponse = await request(
      server,
      "POST",
      "/api/v1/course-imports",
      { semester_id: current.id, source_type: "PDF" },
    );
    expect(startedResponse.statusCode).toBe(200);
    const started = startedResponse.json().data;
    expect(started).toMatchObject({
      semester_id: current.id,
      status: "AWAITING_SOURCE",
      courses: [],
    });
    expect(
      (
        await request(
          server,
          "POST",
          `/api/v1/course-imports/${started.id}/commit`,
          undefined,
          "owner",
          randomUUID(),
        )
      ).statusCode,
    ).toBe(409);

    const source = {
      file_name: "课程表.pdf",
      media_type: "application/pdf",
      content_base64: Buffer.from("%PDF deterministic fixture").toString(
        "base64",
      ),
    };
    const previewResponse = await request(
      server,
      "POST",
      `/api/v1/course-imports/${started.id}/source`,
      source,
    );
    expect(previewResponse.statusCode).toBe(200);
    const preview = previewResponse.json().data;
    expect(preview.status).toBe("NEEDS_RESOLUTION");
    expect(preview.courses).toMatchObject([
      {
        name: "环境经济学",
        duplicate_candidates: [{ id: priorCourse.id }],
        resolution: null,
      },
      { name: "经济法", duplicate_candidates: [], resolution: null },
    ]);

    // A fresh service instance can recover the checkpoint without source bytes.
    const reopened = new CloudCourseImportManager(database, parser);
    expect(await reopened.get(owner, started.id)).toMatchObject({
      status: "NEEDS_RESOLUTION",
      source_name: "课程表.pdf",
      courses: [{ name: "环境经济学" }, { name: "经济法" }],
    });
    expect(
      (
        await request(
          server,
          "GET",
          `/api/v1/course-imports/${started.id}`,
          undefined,
          "other",
        )
      ).statusCode,
    ).toBe(404);

    const resolvedResponse = await request(
      server,
      "POST",
      `/api/v1/course-imports/${started.id}/resolve-course`,
      {
        incoming_course_name: "环境经济学",
        decision: "SAME_COURSE",
        existing_course_id: priorCourse.id,
      },
    );
    expect(resolvedResponse.json().data.status).toBe("READY");

    const commitKey = randomUUID();
    const committedResponse = await request(
      server,
      "POST",
      `/api/v1/course-imports/${started.id}/commit`,
      undefined,
      "owner",
      commitKey,
    );
    expect(committedResponse.statusCode).toBe(200);
    const committed = committedResponse.json().data;
    expect(committed).toMatchObject({
      reused_existing_import: false,
      course_ids: expect.any(Array),
    });
    expect(committed.course_ids).toHaveLength(2);
    expect(
      (
        await request(
          server,
          "POST",
          `/api/v1/course-imports/${started.id}/commit`,
          undefined,
          "owner",
          commitKey,
        )
      ).json().data,
    ).toEqual(committed);

    const currentCourses = (
      await cloud.listCourses(owner, current.id, null, 50)
    ).data;
    expect(currentCourses.map((course) => course.name).sort()).toEqual([
      "环境经济学",
      "经济法",
    ]);
    const importedEnvironment = currentCourses.find(
      (course) => course.name === "环境经济学",
    )!;
    expect(
      (
        await cloud.listCourseInformation(
          owner,
          importedEnvironment.id,
          null,
          50,
        )
      ).data.map((value) => value.content),
    ).toEqual(["教材是第四版"]);
    expect(
      await academic.schedules(owner, importedEnvironment.id),
    ).toMatchObject([
      {
        weekday: 2,
        start_time: "09:00:00",
        classroom: "A101",
      },
    ]);
    const items = await postgres.query<{ id: string; course_id: string }>(
      "SELECT id,course_id FROM items ORDER BY id",
    );
    expect(items.rows).toEqual([
      { id: historicalItem.id, course_id: priorCourse.id },
    ]);

    // A new job for the same file and semester resolves to the original commit.
    const second = (
      await request(server, "POST", "/api/v1/course-imports", {
        semester_id: current.id,
        source_type: "PDF",
      })
    ).json().data;
    await request(
      server,
      "POST",
      `/api/v1/course-imports/${second.id}/source`,
      source,
    );
    await request(
      server,
      "POST",
      `/api/v1/course-imports/${second.id}/resolve-course`,
      {
        incoming_course_name: "环境经济学",
        decision: "NEW_COURSE",
      },
    );
    const reused = (
      await request(
        server,
        "POST",
        `/api/v1/course-imports/${second.id}/commit`,
        undefined,
        "owner",
        randomUUID(),
      )
    ).json().data;
    expect(reused).toEqual({
      course_ids: committed.course_ids,
      reused_existing_import: true,
    });
    expect(
      (await cloud.listCourses(owner, current.id, null, 50)).data,
    ).toHaveLength(2);
    expect(
      (
        await request(
          server,
          "GET",
          `/api/v1/course-imports?semester_id=${current.id}`,
        )
      ).json().data,
    ).toEqual([]);
  } finally {
    await server.close();
    await postgres.close();
  }
});

it("keeps a failed parse recoverable and commits no partial Course data", async () => {
  let valid = false;
  const parser: CourseImportParser = {
    parse: async () => (valid ? parsedCourses : { courses: [] }),
  };
  const { postgres, cloud, academic, imports, server } = await harness(parser);
  try {
    const semester = await academic.createSemester(owner, randomUUID(), {
      name: "2026 秋季学期",
      start_date: "2026-09-01",
      end_date: "2026-12-31",
    });
    const started = await imports.start(owner, semester.id, "IMAGE");
    const source = {
      file_name: "课程表.png",
      media_type: "image/png",
      content_base64: Buffer.from("image fixture").toString("base64"),
    };
    const failed = await request(
      server,
      "POST",
      `/api/v1/course-imports/${started.id}/source`,
      source,
    );
    expect(failed.statusCode).toBe(422);
    expect(await imports.get(owner, started.id)).toMatchObject({
      status: "FAILED",
      courses: [],
      // The file was readable, the model simply found nothing: say that
      // instead of blaming the file's clarity.
      error_message:
        "未从该文件中识别出课程。请确认这是本学期的课程表且内容清晰，也可以改用清晰截图重新导入。",
    });
    expect(
      (await cloud.listCourses(owner, semester.id, null, 50)).data,
    ).toEqual([]);

    valid = true;
    const recovered = await imports.parseSource(owner, started.id, source);
    expect(recovered.status).toBe("READY");
    const result = await imports.commit(owner, started.id, randomUUID());
    expect(result.course_ids).toHaveLength(2);
    expect(
      (await cloud.listCourses(owner, semester.id, null, 50)).data,
    ).toHaveLength(2);
  } finally {
    await server.close();
    await postgres.close();
  }
});

it("imports a periods-only timetable with null clock times end to end", async () => {
  let calls = 0;
  const parser: CourseImportParser = {
    parse: async () => {
      calls += 1;
      return {
        courses: parsedCourses.courses.map((course) => ({
          ...course,
          schedules: course.schedules.map((schedule) => ({
            ...schedule,
            start_time: null,
            end_time: null,
            stage_label: "12-13节",
          })),
        })),
      };
    },
  };
  const { postgres, academic, imports, server } = await harness(parser);
  try {
    const semester = await academic.createSemester(owner, randomUUID(), {
      name: "2026 秋季学期",
      start_date: "2026-09-01",
      end_date: "2026-12-31",
    });
    const job = await imports.start(owner, semester.id, "IMAGE");
    const source = {
      file_name: "课程表.png",
      media_type: "image/png",
      content_base64: Buffer.from("image fixture").toString("base64"),
    };
    // null times pass the contract, so the first round is already valid —
    // no schema retry (the old end>start failure would have needed two).
    const ready = await imports.parseSource(owner, job.id, source);
    expect(ready.status).toBe("READY");
    expect(calls).toBe(1);
    const result = await imports.commit(owner, job.id, randomUUID());
    expect(result.course_ids.length).toBeGreaterThan(0);
    const rows = await academic.schedules(owner, result.course_ids[0]!);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toMatchObject({
      start_time: null,
      end_time: null,
      stage_label: "12-13节",
    });
  } finally {
    await server.close();
    await postgres.close();
  }
});

it("serves repeat uploads from the parse cache and re-parses per generation", async () => {
  let calls = 0;
  const parser: CourseImportParser = {
    fingerprint: "gen-1",
    parse: async () => {
      calls += 1;
      return parsedCourses;
    },
  };
  const { postgres, academic, imports, server } = await harness(parser);
  try {
    const semester = await academic.createSemester(owner, randomUUID(), {
      name: "2026 秋季学期",
      start_date: "2026-09-01",
      end_date: "2026-12-31",
    });
    const source = {
      file_name: "课程表.png",
      media_type: "image/png",
      content_base64: Buffer.from("image fixture").toString("base64"),
    };

    const first = await imports.start(owner, semester.id, "IMAGE");
    const firstReady = await imports.parseSource(owner, first.id, source);
    expect(firstReady.status).toBe("READY");
    expect(calls).toBe(1);

    // Same bytes + same generation: the answer comes from the cache.
    const second = await imports.start(owner, semester.id, "IMAGE");
    const secondReady = await imports.parseSource(owner, second.id, source);
    expect(calls).toBe(1);
    expect(secondReady.status).toBe("READY");
    expect(secondReady.courses).toHaveLength(firstReady.courses.length);

    // A new prompt/model generation must not inherit the old answer.
    (parser as { fingerprint?: string }).fingerprint = "gen-2";
    const third = await imports.start(owner, semester.id, "IMAGE");
    await imports.parseSource(owner, third.id, source);
    expect(calls).toBe(2);

    // Another owner uploading the same bytes never sees this owner's cache.
    const otherSemester = await academic.createSemester(
      otherOwner,
      randomUUID(),
      {
        name: "2026 秋季学期",
        start_date: "2026-09-01",
        end_date: "2026-12-31",
      },
    );
    const otherJob = await imports.start(otherOwner, otherSemester.id, "IMAGE");
    await imports.parseSource(otherOwner, otherJob.id, source);
    expect(calls).toBe(3);
  } finally {
    await server.close();
    await postgres.close();
  }
});

it("writes fresh courses when the previous commit's courses were cleaned up", async () => {
  const parser: CourseImportParser = {
    fingerprint: "gen-1",
    parse: async () => parsedCourses,
  };
  const { postgres, cloud, academic, imports, server } = await harness(parser);
  try {
    const semester = await academic.createSemester(owner, randomUUID(), {
      name: "2026 秋季学期",
      start_date: "2026-09-01",
      end_date: "2026-12-31",
    });
    const source = {
      file_name: "课程表.png",
      media_type: "image/png",
      content_base64: Buffer.from("image fixture").toString("base64"),
    };

    const first = await imports.start(owner, semester.id, "IMAGE");
    await imports.parseSource(owner, first.id, source);
    const firstResult = await imports.commit(owner, first.id, randomUUID());
    expect(firstResult.reused_existing_import).toBe(false);
    const expected = firstResult.course_ids.length;
    expect(expected).toBeGreaterThan(0);
    expect(
      (await cloud.listCourses(owner, semester.id, null, 50)).data,
    ).toHaveLength(expected);

    // The production bug: the user cleaned the semester up, then imported
    // the same file again — the stale commit record made the commit
    // "succeed" (已建立 22 门课程) without writing a single row.
    await postgres.query(
      "UPDATE courses SET deleted_at=now() WHERE owner_id=$1",
      [owner],
    );
    expect(
      (await cloud.listCourses(owner, semester.id, null, 50)).data,
    ).toHaveLength(0);

    const second = await imports.start(owner, semester.id, "IMAGE");
    await imports.parseSource(owner, second.id, source);
    const secondResult = await imports.commit(owner, second.id, randomUUID());
    expect(secondResult.reused_existing_import).toBe(false);
    expect(secondResult.course_ids).toHaveLength(expected);
    expect(secondResult.course_ids).not.toEqual(firstResult.course_ids);
    expect(
      (await cloud.listCourses(owner, semester.id, null, 50)).data,
    ).toHaveLength(expected);

    // Partial cleanup: survivors are kept by name (no twins), the deleted
    // entry is created fresh.
    const alive = (await cloud.listCourses(owner, semester.id, null, 50))
      .data as { id: string; name: string }[];
    const victim = alive[0]!;
    await postgres.query("UPDATE courses SET deleted_at=now() WHERE id=$1", [
      victim.id,
    ]);
    const third = await imports.start(owner, semester.id, "IMAGE");
    await imports.parseSource(owner, third.id, source);
    const thirdResult = await imports.commit(owner, third.id, randomUUID());
    expect(thirdResult.reused_existing_import).toBe(false);
    expect(thirdResult.course_ids).toHaveLength(expected);
    expect(thirdResult.course_ids).not.toContain(victim.id);
    const after = (await cloud.listCourses(owner, semester.id, null, 50))
      .data as { id: string; name: string }[];
    expect(after).toHaveLength(expected);
    expect(new Set(after.map((course) => course.name)).size).toBe(expected);
  } finally {
    await server.close();
    await postgres.close();
  }
});

it("maps provider and source failures to product messages and stays recoverable", async () => {
  let mode: "provider" | "too_large" | "valid" = "provider";
  const parser: CourseImportParser = {
    parse: async () => {
      if (mode === "provider") throw new ProviderError("UNAVAILABLE", 503);
      if (mode === "too_large")
        throw new CourseImportParseError(
          "TOO_LARGE",
          "课程表文件图像内容过大，无法安全解析，请压缩后重试。",
        );
      return parsedCourses;
    },
  };
  const { postgres, academic, imports, server } = await harness(parser);
  try {
    const semester = await academic.createSemester(owner, randomUUID(), {
      name: "2026 秋季学期",
      start_date: "2026-09-01",
      end_date: "2026-12-31",
    });
    const source = {
      file_name: "课程表.png",
      media_type: "image/png",
      content_base64: Buffer.from("image fixture").toString("base64"),
    };
    const job = await imports.start(owner, semester.id, "IMAGE");

    await expect(
      imports.parseSource(owner, job.id, source),
    ).rejects.toMatchObject({
      code: "IMPORT_FAILED",
      message: "智能整理暂时不可用，文件已保留，请稍后重试。",
    });
    expect(await imports.get(owner, job.id)).toMatchObject({
      status: "FAILED",
      error_message: "智能整理暂时不可用，文件已保留，请稍后重试。",
    });

    mode = "too_large";
    await expect(
      imports.parseSource(owner, job.id, source),
    ).rejects.toMatchObject({
      message: expect.stringContaining("过大"),
    });
    const failed = await imports.get(owner, job.id);
    expect(failed.status).toBe("FAILED");
    expect(failed.error_message).not.toMatch(
      /ProviderError|base64|payload|stack/i,
    );

    // Oversized sources are refused before any provider call.
    const oversized = {
      ...source,
      content_base64: Buffer.alloc(16 * 1024 * 1024).toString("base64"),
    };
    await expect(
      imports.parseSource(owner, job.id, oversized),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining("15 MB"),
    });

    mode = "valid";
    const recovered = await imports.parseSource(owner, job.id, source);
    expect(recovered.status).toBe("READY");
    expect(recovered.error_message).toBeNull();
  } finally {
    await server.close();
    await postgres.close();
  }
});

it("accepts a different media type when the user re-picks a file", async () => {
  const { postgres, academic, imports, server } = await harness({
    parse: async () => parsedCourses,
  });
  try {
    const semester = await academic.createSemester(owner, randomUUID(), {
      name: "2026 秋季学期",
      start_date: "2026-09-01",
      end_date: "2026-12-31",
    });
    // The job was created from a screenshot; the panel then offers
    // "重新选择课程表文件" and the user picks a PDF. Comparing the upload
    // against the stored type rejected that with an English message that
    // errors.ts translated into the oversized-file copy.
    const job = await imports.start(owner, semester.id, "IMAGE");
    const response = await request(
      server,
      "POST",
      `/api/v1/course-imports/${job.id}/source`,
      {
        file_name: "课程表.pdf",
        media_type: "application/pdf",
        content_base64: Buffer.from("%PDF deterministic fixture").toString(
          "base64",
        ),
      },
    );
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      source_type: "PDF",
      status: "READY",
    });
    expect(await imports.get(owner, job.id)).toMatchObject({
      source_type: "PDF",
      status: "READY",
      error_message: null,
    });
  } finally {
    await server.close();
    await postgres.close();
  }
});

it("rate-limits source parsing and leaves the import job usable", async () => {
  const { postgres, cloud, academic, imports, server } = await harness(
    { parse: async () => parsedCourses },
    new RateLimiter({ limit: 1, windowMs: 60_000 }),
  );
  try {
    const semester = await academic.createSemester(owner, randomUUID(), {
      name: "2026 秋季学期",
      start_date: "2026-09-01",
      end_date: "2026-12-31",
    });
    const job = await imports.start(owner, semester.id, "IMAGE");
    const source = {
      file_name: "课程表.png",
      media_type: "image/png",
      content_base64: Buffer.from("image fixture").toString("base64"),
    };

    const first = await request(
      server,
      "POST",
      `/api/v1/course-imports/${job.id}/source`,
      source,
    );
    expect(first.statusCode).toBe(200);
    expect(await imports.get(owner, job.id)).toMatchObject({ status: "READY" });

    const limited = await request(
      server,
      "POST",
      `/api/v1/course-imports/${job.id}/source`,
      source,
    );
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error).toMatchObject({
      code: "RATE_LIMITED",
      message: "请求过于频繁，请稍后再试。",
    });
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);

    // The rejected attempt is side-effect free: no FAILED state, no commit,
    // and the preview stays exactly as the successful parse left it.
    expect(await imports.get(owner, job.id)).toMatchObject({
      status: "READY",
      error_message: null,
    });
    expect(
      (await cloud.listCourses(owner, semester.id, null, 50)).data,
    ).toHaveLength(0);
  } finally {
    await server.close();
    await postgres.close();
  }
});

it("retries one model round when the payload breaks a schema rule", async () => {
  let calls = 0;
  const parser: CourseImportParser = {
    parse: async () => {
      calls += 1;
      if (calls > 1) return parsedCourses;
      // Real failure sample: a schedule whose end precedes its start.
      return {
        courses: parsedCourses.courses.map((course) => ({
          ...course,
          schedules: course.schedules.map((schedule) => ({
            ...schedule,
            start_time: "08:00",
            end_time: "07:00",
          })),
        })),
      };
    },
  };
  const { postgres, academic, imports, server } = await harness(parser);
  try {
    const semester = await academic.createSemester(owner, randomUUID(), {
      name: "2026 秋季学期",
      start_date: "2026-09-01",
      end_date: "2026-12-31",
    });
    const job = await imports.start(owner, semester.id, "IMAGE");
    const source = {
      file_name: "课程表.png",
      media_type: "image/png",
      content_base64: Buffer.from("image fixture").toString("base64"),
    };
    const ready = await imports.parseSource(owner, job.id, source);
    expect(ready.status).toBe("READY");
    expect(calls).toBe(2);
  } finally {
    await server.close();
    await postgres.close();
  }
});

it("fails with accurate copy when the second round still breaks the schema", async () => {
  let calls = 0;
  const parser: CourseImportParser = {
    parse: async () => {
      calls += 1;
      return {
        courses: parsedCourses.courses.map((course) => ({
          ...course,
          schedules: course.schedules.map((schedule) => ({
            ...schedule,
            start_time: "08:00",
            end_time: "07:00",
          })),
        })),
      };
    },
  };
  const { postgres, academic, imports, server } = await harness(parser);
  try {
    const semester = await academic.createSemester(owner, randomUUID(), {
      name: "2026 秋季学期",
      start_date: "2026-09-01",
      end_date: "2026-12-31",
    });
    const job = await imports.start(owner, semester.id, "IMAGE");
    const source = {
      file_name: "课程表.png",
      media_type: "image/png",
      content_base64: Buffer.from("image fixture").toString("base64"),
    };
    const message =
      "识别结果未能通过校验，请重试一次；若仍失败，再换更清晰的文件。";
    await expect(
      imports.parseSource(owner, job.id, source),
    ).rejects.toMatchObject({ code: "IMPORT_FAILED", message });
    expect(calls).toBe(2);
    expect((await imports.get(owner, job.id)).error_message).toBe(message);
  } finally {
    await server.close();
    await postgres.close();
  }
});

it("discards a recognition result instead of letting it resurface", async () => {
  const parser: CourseImportParser = { parse: async () => parsedCourses };
  const { academic, server, postgres } = await harness(parser);
  try {
    const current = await academic.createSemester(owner, randomUUID(), {
      name: "2026 秋季学期",
      start_date: "2026-09-01",
      end_date: "2026-12-31",
    });
    const source = {
      file_name: "课程表.pdf",
      media_type: "application/pdf",
      content_base64: Buffer.from("%PDF deterministic fixture").toString(
        "base64",
      ),
    };

    const first = (
      await request(server, "POST", "/api/v1/course-imports", {
        semester_id: current.id,
        source_type: "PDF",
      })
    ).json().data;
    const preview = await request(
      server,
      "POST",
      `/api/v1/course-imports/${first.id}/source`,
      source,
    );
    expect(preview.statusCode).toBe(200);
    expect(preview.json().data.courses).toHaveLength(2);

    // Discarding removes the job: listPending would otherwise hand the same
    // preview back on the next page load.
    const discarded = await request(
      server,
      "DELETE",
      `/api/v1/course-imports/${first.id}`,
    );
    expect(discarded.statusCode).toBe(200);
    expect(
      (
        await request(
          server,
          "GET",
          `/api/v1/course-imports?semester_id=${current.id}`,
        )
      ).json().data,
    ).toEqual([]);
    expect(
      (
        await request(
          server,
          "POST",
          `/api/v1/course-imports/${first.id}/commit`,
          undefined,
          "owner",
          randomUUID(),
        )
      ).statusCode,
    ).toBe(404);

    // A committed result keeps its courses and cannot be discarded.
    const second = (
      await request(server, "POST", "/api/v1/course-imports", {
        semester_id: current.id,
        source_type: "PDF",
      })
    ).json().data;
    await request(
      server,
      "POST",
      `/api/v1/course-imports/${second.id}/source`,
      source,
    );
    const committed = await request(
      server,
      "POST",
      `/api/v1/course-imports/${second.id}/commit`,
      undefined,
      "owner",
      randomUUID(),
    );
    expect(committed.statusCode).toBe(200);
    expect(
      (await request(server, "DELETE", `/api/v1/course-imports/${second.id}`))
        .statusCode,
    ).toBe(409);
  } finally {
    await postgres.close();
  }
});

it("rejects a source that is neither a PDF nor an image", async () => {
  const parser: CourseImportParser = { parse: async () => parsedCourses };
  const { academic, imports, postgres } = await harness(parser);
  try {
    const current = await academic.createSemester(owner, randomUUID(), {
      name: "2026 秋季学期",
      start_date: "2026-09-01",
      end_date: "2026-12-31",
    });
    const job = await imports.start(owner, current.id, "PDF");
    // Called directly: HTTP would be stopped by the media_type enum first.
    await expect(
      imports.parseSource(owner, job.id, {
        file_name: "notes.txt",
        media_type: "text/plain",
        content_base64: Buffer.from("hello").toString("base64"),
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "只支持 PDF 和图片文件。",
    });
    expect(await imports.get(owner, job.id)).toMatchObject({
      status: "AWAITING_SOURCE",
    });
  } finally {
    await postgres.close();
  }
});

it("reports a timeout as a timeout, not as a generic AI outage", () => {
  expect(importFailureMessage(new ProviderError("TIMEOUT", null))).toBe(
    "识别服务响应超时，文件已保留，请稍后再试。",
  );
  expect(importFailureMessage(new ProviderError("UNAVAILABLE", null))).toBe(
    "智能整理暂时不可用，文件已保留，请稍后重试。",
  );
});
