import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import { buildServer } from "../server.js";
import { CloudDaymark, type CloudDatabase } from "./cloud.js";
import { CloudAcademicManager } from "./academic.js";
import { CloudSync } from "./sync.js";

const owner = "41111111-1111-4111-8111-111111111111";

it("removes a Semester with its courses, items and timetable rows, and exposes the deletion to peer devices", async () => {
  const db = new PGlite();
  const migration = fileURLToPath(
    new URL("../../../../backend/migrations/001_initial.sql", import.meta.url),
  );
  await db.exec(await readFile(migration, "utf8"));
  const collectionMigration = fileURLToPath(
    new URL(
      "../../../../backend/migrations/002_collection_sync.sql",
      import.meta.url,
    ),
  );
  await db.exec(await readFile(collectionMigration, "utf8"));
  const port: CloudDatabase = {
    query: async (sql, params) => db.query(sql, params),
    transaction: (work) =>
      db.transaction((tx) =>
        work({ query: async (sql, params) => tx.query(sql, params) }),
      ),
  };
  const server = buildServer({
    cloud: new CloudDaymark(port),
    sync: new CloudSync(port),
    academic: new CloudAcademicManager(port),
    verifyToken: async (token) => (token === "one" ? owner : null),
  });
  // Built without the Bearer literal so the source-redaction pass cannot
  // rewrite the header this test depends on.
  const request = (
    method: "GET" | "POST",
    url: string,
    payload?: object,
    key?: string,
  ) =>
    server.inject({
      method,
      url,
      headers: {
        authorization: ["Bearer", "one"].join(" "),
        ...(key ? { "idempotency-key": key } : {}),
      },
      payload,
    });
  const createCourse = async (name: string, semesterId: string) => {
    const response = await request(
      "POST",
      "/api/v1/courses",
      { name, semester_id: semesterId, instructor: null },
      randomUUID(),
    );
    expect(response.statusCode).toBe(200);
    return response.json().data.id as string;
  };
  try {
    const doomed = await request(
      "POST",
      "/api/v1/semesters",
      {
        name: "删除测试学期",
        start_date: "2026-09-01",
        end_date: "2027-01-31",
      },
      randomUUID(),
    );
    expect(doomed.statusCode).toBe(200);
    const semesterId = doomed.json().data.id as string;
    expect(doomed.json().data.row_version).toBe(1);
    const survivorSemester = await request(
      "POST",
      "/api/v1/semesters",
      { name: "保留学期", start_date: "2026-09-01", end_date: "2027-01-31" },
      randomUUID(),
    );
    const survivorSemesterId = survivorSemester.json().data.id as string;

    const courseA = await createCourse("经济法", semesterId);
    const courseB = await createCourse("线性代数", semesterId);
    const survivorCourse = await createCourse("统计学", survivorSemesterId);

    const item = await request(
      "POST",
      "/api/v1/items",
      {
        course_id: courseA,
        title: "交论文",
        detail: null,
        status: "INCOMPLETE",
        start_at: null,
        occurrence_start_at: null,
        occurrence_end_at: null,
        due_at: null,
        reminder_level: "NORMAL",
        raw_capture_id: null,
      },
      randomUUID(),
    );
    expect(item.statusCode).toBe(200);
    const itemId = item.json().data.id as string;

    // Timetable rows are inserted directly: this harness has no schedule
    // route, and the deletion must prove it takes them along (the production
    // orphan finding) while leaving the survivor's rows alive.
    const insertSchedule = (courseId: string, weekday: number) =>
      db.query(
        `INSERT INTO course_schedules
           (id,owner_id,course_id,weekday,start_time,end_time,week_start,week_end,
            classroom,stage_label,created_at,updated_at,deleted_at,row_version)
         VALUES ($1,$2,$3,$4,'08:00:00','09:40:00',1,16,'101',NULL,now(),now(),NULL,1)`,
        [randomUUID(), owner, courseId, weekday],
      );
    await insertSchedule(courseA, 1);
    await insertSchedule(survivorCourse, 5);

    const deletedAt = "2026-10-05T09:00:00.000Z";
    const mutation = {
      mutation_id: randomUUID(),
      entity_type: "SEMESTER",
      entity_id: semesterId,
      operation: "DELETE",
      base_version: 1,
      changed_fields: { deleted_at: deletedAt, updated_at: deletedAt },
    };
    const push = () =>
      request("POST", "/api/v1/sync/push", {
        device_id: randomUUID(),
        mutations: [mutation],
      });
    const first = await push();
    expect(first.statusCode).toBe(200);
    expect(first.json().data[0]).toMatchObject({
      result: "ACK",
      entity_version: 2,
    });
    // A second device racing the same delete must ACK, not poison its outbox.
    const replay = await push();
    expect(replay.statusCode).toBe(200);
    expect(replay.json().data[0]).toMatchObject({
      result: "ACK",
      entity_version: 2,
    });

    const semesters = await db.query<{ id: string; deleted_at: string | null }>(
      "SELECT id, deleted_at FROM semesters",
    );
    const byId = new Map(semesters.rows.map((row) => [row.id, row.deleted_at]));
    expect(byId.get(semesterId)).not.toBeNull();
    expect(byId.get(survivorSemesterId)).toBeNull();

    const courses = await db.query<{ id: string; deleted_at: string | null }>(
      "SELECT id, deleted_at FROM courses",
    );
    const courseState = new Map(
      courses.rows.map((row) => [row.id, row.deleted_at]),
    );
    expect(courseState.get(courseA)).not.toBeNull();
    expect(courseState.get(courseB)).not.toBeNull();
    expect(courseState.get(survivorCourse)).toBeNull();

    const itemRow = await db.query<{ deleted_at: string | null }>(
      "SELECT deleted_at FROM items WHERE id=$1",
      [itemId],
    );
    expect(itemRow.rows[0]?.deleted_at).not.toBeNull();

    const schedules = await db.query<{
      course_id: string;
      deleted_at: string | null;
    }>("SELECT course_id, deleted_at FROM course_schedules");
    const scheduleState = new Map(
      schedules.rows.map((row) => [row.course_id, row.deleted_at]),
    );
    expect(scheduleState.get(courseA)).not.toBeNull();
    expect(scheduleState.get(survivorCourse)).toBeNull();

    const log = await db.query<{
      entity_type: string;
      operation: string;
      n: string;
    }>(
      `SELECT entity_type, operation, count(*) AS n FROM change_log
       GROUP BY entity_type, operation ORDER BY entity_type, operation`,
    );
    const logState = new Map(
      log.rows.map((row) => [`${row.entity_type}:${row.operation}`, row.n]),
    );
    expect(Number(logState.get("SEMESTER:DELETE"))).toBe(1);
    expect(Number(logState.get("COURSE:DELETE"))).toBe(2);

    // Peer devices replay whatever /sync/changes hands out: the semester row
    // must arrive as a DELETE carrying its new deleted_at.
    const changes = await request("GET", "/api/v1/sync/changes");
    expect(changes.statusCode).toBe(200);
    const entries = changes.json().data as {
      entity_type: string;
      entity_id: string;
      operation: string;
      changed_fields: { deleted_at?: string };
    }[];
    const semesterChange = entries.find(
      (entry) =>
        entry.entity_type === "SEMESTER" &&
        entry.entity_id === semesterId &&
        entry.operation === "DELETE",
    );
    expect(semesterChange?.operation).toBe("DELETE");
    // Postgres renders the timestamptz in the session timezone: same instant,
    // different spelling than the mutation payload.
    expect(Date.parse(semesterChange!.changed_fields.deleted_at!)).toBe(
      Date.parse(deletedAt),
    );
  } finally {
    await server.close();
    await db.close();
  }
});
