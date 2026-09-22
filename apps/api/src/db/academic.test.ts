import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import { buildServer } from "../server.js";
import { CloudCourseManager, type CloudDatabase } from "./cloud.js";
import { CloudSync } from "./sync.js";
import { CloudAcademicManager } from "./academic.js";

const ownerOne = "11111111-1111-4111-8111-111111111111";
const ownerTwo = "22222222-2222-4222-8222-222222222222";

it("serves owner-scoped Semester weeks and atomic Course schedules on the canonical change stream", async () => {
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
  const server = buildServer({
    cloud: new CloudCourseManager(port),
    academic: new CloudAcademicManager(port),
    sync: new CloudSync(port),
    verifyToken: async (token) =>
      token === "one" ? ownerOne : token === "two" ? ownerTwo : null,
  });
  const request = (
    method: "GET" | "POST" | "PUT" | "PATCH",
    url: string,
    token: string,
    payload?: object,
    key?: string,
    match?: number,
  ) =>
    server.inject({
      method,
      url,
      headers: {
        authorization: `Bearer ${token}`,
        ...(key ? { "idempotency-key": key } : {}),
        ...(match ? { "if-match": String(match) } : {}),
      },
      payload,
    });
  try {
    const semesterKey = randomUUID();
    const semesterPayload = {
      name: "2026 秋季学期",
      start_date: "2026-09-01",
      end_date: "2026-12-31",
    };
    const created = await request(
      "POST",
      "/api/v1/semesters",
      "one",
      semesterPayload,
      semesterKey,
    );
    expect(created.statusCode).toBe(200);
    const semesterId = created.json().data.id as string;
    expect(
      (
        await request(
          "POST",
          "/api/v1/semesters",
          "one",
          semesterPayload,
          semesterKey,
        )
      ).json().data.id,
    ).toBe(semesterId);
    expect(
      (await request("GET", "/api/v1/semesters", "two")).json().data,
    ).toEqual([]);
    expect(
      (await request("GET", `/api/v1/semesters/${semesterId}`, "two"))
        .statusCode,
    ).toBe(404);
    const revised = await request(
      "PATCH",
      `/api/v1/semesters/${semesterId}`,
      "one",
      { name: "2026 秋" },
      randomUUID(),
      1,
    );
    expect(revised.json().data).toMatchObject({
      name: "2026 秋",
      row_version: 2,
    });
    expect(
      (
        await request(
          "PATCH",
          `/api/v1/semesters/${semesterId}`,
          "one",
          { name: "过期版本" },
          randomUUID(),
          1,
        )
      ).statusCode,
    ).toBe(409);
    const invalidWeeks = await request(
      "PUT",
      `/api/v1/semesters/${semesterId}/weeks`,
      "one",
      {
        weeks: [
          { week_number: 1, start_date: "2026-09-01", end_date: "2026-09-08" },
          { week_number: 2, start_date: "2026-09-08", end_date: "2026-09-14" },
        ],
      },
      randomUUID(),
    );
    expect(invalidWeeks.statusCode).toBe(400);
    const weekKey = randomUUID();
    const weekPayload = {
      weeks: [
        { week_number: 1, start_date: "2026-09-01", end_date: "2026-09-07" },
      ],
    };
    const weeks = await request(
      "PUT",
      `/api/v1/semesters/${semesterId}/weeks`,
      "one",
      weekPayload,
      weekKey,
    );
    expect(weeks.statusCode).toBe(200);
    expect(
      (
        await request(
          "PUT",
          `/api/v1/semesters/${semesterId}/weeks`,
          "one",
          weekPayload,
          weekKey,
        )
      ).json().data,
    ).toEqual(weeks.json().data);
    expect(
      (
        await request("GET", `/api/v1/semesters/${semesterId}/weeks`, "one")
      ).json().data,
    ).toHaveLength(1);

    const course = await request(
      "POST",
      "/api/v1/courses",
      "one",
      { name: "统计学", semester_id: semesterId, instructor: null },
      randomUUID(),
    );
    expect(course.statusCode).toBe(200);
    const courseId = course.json().data.id as string;
    const schedules = {
      schedules: [
        {
          weekday: 3,
          start_time: "14:00:00",
          end_time: "15:40:00",
          week_start: 1,
          week_end: 13,
          classroom: "101",
          stage_label: null,
        },
      ],
    };
    const scheduleKey = randomUUID();
    const saved = await request(
      "PUT",
      `/api/v1/courses/${courseId}/schedules`,
      "one",
      schedules,
      scheduleKey,
    );
    expect(saved.statusCode).toBe(200);
    expect(saved.json().data).toHaveLength(1);
    expect(
      (
        await request(
          "PUT",
          `/api/v1/courses/${courseId}/schedules`,
          "one",
          schedules,
          scheduleKey,
        )
      ).json().data,
    ).toEqual(saved.json().data);
    expect(
      (await request("GET", `/api/v1/courses/${courseId}/schedules`, "two"))
        .statusCode,
    ).toBe(404);
    expect(
      (await request("GET", "/api/v1/items?has_time=true", "one")).json().data,
    ).toEqual([]);
    const removed = await request(
      "PUT",
      `/api/v1/courses/${courseId}/schedules`,
      "one",
      { schedules: [] },
      randomUUID(),
    );
    expect(removed.statusCode).toBe(200);
    expect(
      (
        await request("GET", `/api/v1/courses/${courseId}/schedules`, "one")
      ).json().data,
    ).toEqual([]);
    const changes = await request("GET", "/api/v1/sync/changes", "one");
    expect(
      changes
        .json()
        .data.some(
          (entry: { entity_type: string; operation: string }) =>
            entry.entity_type === "COURSE_SCHEDULE" &&
            entry.operation === "DELETE",
        ),
    ).toBe(true);
  } finally {
    await server.close();
    await db.close();
  }
});
