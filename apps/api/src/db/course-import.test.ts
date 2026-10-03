import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import { buildServer } from "../server.js";
import { CloudAcademicManager } from "./academic.js";
import {
  CloudCourseImportManager,
  type CourseImportParser,
} from "./course-import.js";
import { CloudCourseManager, type CloudDatabase } from "./cloud.js";
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
  const cloud = new CloudCourseManager(database);
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
  method: "GET" | "POST",
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
      occurrence_start_at: null,
      occurrence_end_at: null,
      due_at: null,
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

it("refuses a source whose media type does not match the declared import type", async () => {
  const { postgres, academic, imports, server } = await harness({
    parse: async () => parsedCourses,
  });
  try {
    const semester = await academic.createSemester(owner, randomUUID(), {
      name: "2026 秋季学期",
      start_date: "2026-09-01",
      end_date: "2026-12-31",
    });
    const job = await imports.start(owner, semester.id, "IMAGE");
    const response = await request(
      server,
      "POST",
      `/api/v1/course-imports/${job.id}/source`,
      {
        file_name: "课程表.pdf",
        media_type: "application/pdf",
        content_base64: Buffer.from("not an image").toString("base64"),
      },
    );
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VALIDATION_ERROR");
    expect(await imports.get(owner, job.id)).toMatchObject({
      status: "AWAITING_SOURCE",
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
