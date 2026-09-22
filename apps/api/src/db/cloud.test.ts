import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import { buildServer } from "../server.js";
import { CloudCourseManager, type CloudDatabase } from "./cloud.js";

const ownerOne = "11111111-1111-4111-8111-111111111111";
const ownerTwo = "22222222-2222-4222-8222-222222222222";

it("protects the capture → course → item API, persists provenance, and replays idempotently", async () => {
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
    verifyToken: async (token) =>
      token === "one" ? ownerOne : token === "two" ? ownerTwo : null,
  });
  try {
    const unauthorized = await server.inject({
      method: "POST",
      url: "/api/v1/raw-captures",
      payload: {
        source: "QUICK_CAPTURE",
        raw_text: "找学姐要笔记",
        captured_at: "2026-09-22T08:00:00Z",
      },
    });
    expect(unauthorized.statusCode).toBe(401);
    expect(unauthorized.json().error.code).toBe("AUTH_REQUIRED");

    const rawKey = randomUUID();
    const rawPayload = {
      source: "QUICK_CAPTURE",
      raw_text: "找学姐要笔记",
      captured_at: "2026-09-22T08:00:00Z",
    };
    const capture = await server.inject({
      method: "POST",
      url: "/api/v1/raw-captures",
      headers: { authorization: "Bearer one", "idempotency-key": rawKey },
      payload: rawPayload,
    });
    expect(capture.statusCode).toBe(200);
    const rawId = capture.json().data.id as string;
    const replay = await server.inject({
      method: "POST",
      url: "/api/v1/raw-captures",
      headers: { authorization: "Bearer one", "idempotency-key": rawKey },
      payload: rawPayload,
    });
    expect(replay.json().data.id).toBe(rawId);
    expect(
      (await db.query<{ count: string }>("SELECT count(*) FROM raw_captures"))
        .rows[0]?.count,
    ).toBe(1);
    const differentPayload = await server.inject({
      method: "POST",
      url: "/api/v1/raw-captures",
      headers: { authorization: "Bearer one", "idempotency-key": rawKey },
      payload: { ...rawPayload, raw_text: "别的输入" },
    });
    expect(differentPayload.statusCode).toBe(409);
    expect(differentPayload.json().error.code).toBe("IDEMPOTENCY_REPLAY");

    const course = await server.inject({
      method: "POST",
      url: "/api/v1/courses",
      headers: { authorization: "Bearer one", "idempotency-key": randomUUID() },
      payload: { name: "环境经济学", semester_id: null, instructor: null },
    });
    expect(course.statusCode).toBe(200);
    const courseId = course.json().data.id as string;
    const itemPayload = {
      title: "找学姐要笔记",
      detail: null,
      course_id: courseId,
      status: "INCOMPLETE",
      start_at: null,
      occurrence_start_at: null,
      occurrence_end_at: null,
      due_at: null,
      reminder_level: "NORMAL",
      raw_capture_id: rawId,
    };
    const ownerLeak = await server.inject({
      method: "POST",
      url: "/api/v1/items",
      headers: { authorization: "Bearer two", "idempotency-key": randomUUID() },
      payload: itemPayload,
    });
    expect(ownerLeak.statusCode).toBe(404);
    const item = await server.inject({
      method: "POST",
      url: "/api/v1/items",
      headers: { authorization: "Bearer one", "idempotency-key": randomUUID() },
      payload: itemPayload,
    });
    expect(item.statusCode).toBe(200);
    const itemId = item.json().data.id as string;
    const hidden = await server.inject({
      method: "GET",
      url: `/api/v1/items/${itemId}`,
      headers: { authorization: "Bearer two" },
    });
    expect(hidden.statusCode).toBe(404);
    const visible = await server.inject({
      method: "GET",
      url: `/api/v1/items/${itemId}`,
      headers: { authorization: "Bearer one" },
    });
    expect(visible.json().data.id).toBe(itemId);
    const courseList = await server.inject({
      method: "GET",
      url: "/api/v1/courses",
      headers: { authorization: "Bearer one" },
    });
    expect(
      courseList.json().data.map((value: { id: string }) => value.id),
    ).toEqual([courseId]);
    const itemList = await server.inject({
      method: "GET",
      url: `/api/v1/items?course_id=${courseId}&has_time=false`,
      headers: { authorization: "Bearer one" },
    });
    expect(
      itemList.json().data.map((value: { id: string }) => value.id),
    ).toEqual([itemId]);
    const overview = await server.inject({
      method: "GET",
      url: "/api/v1/items/overview",
      headers: { authorization: "Bearer one", "x-time-zone": "Asia/Hong_Kong" },
    });
    expect(
      overview.json().data.map((value: { id: string }) => value.id),
    ).toContain(itemId);
    expect(
      (
        await db.query<{ count: string }>(
          "SELECT count(*) FROM raw_capture_outputs",
        )
      ).rows[0]?.count,
    ).toBe(1);
    expect(
      (
        await db.query<{ processing_status: string }>(
          "SELECT processing_status FROM raw_captures WHERE id = $1",
          [rawId],
        )
      ).rows[0]?.processing_status,
    ).toBe("RESOLVED");
    const titleEdit = await server.inject({
      method: "PATCH",
      url: `/api/v1/items/${itemId}`,
      headers: {
        authorization: "Bearer one",
        "idempotency-key": randomUUID(),
        "if-match": "1",
      },
      payload: { title: "找学姐要完整笔记" },
    });
    expect(titleEdit.statusCode).toBe(200);
    expect(titleEdit.json().data.row_version).toBe(2);
    const nonOverlappingEdit = await server.inject({
      method: "PATCH",
      url: `/api/v1/items/${itemId}`,
      headers: {
        authorization: "Bearer one",
        "idempotency-key": randomUUID(),
        "if-match": "1",
      },
      payload: { due_at: "2026-09-28T12:00:00Z" },
    });
    expect(nonOverlappingEdit.statusCode).toBe(200);
    expect(nonOverlappingEdit.json().data.title).toBe("找学姐要完整笔记");
    expect(nonOverlappingEdit.json().data.row_version).toBe(3);
    const calendarRead = await server.inject({
      method: "GET",
      url: `/api/v1/items?from=${encodeURIComponent("2026-09-28T00:00:00Z")}&to=${encodeURIComponent("2026-09-28T23:59:59Z")}`,
      headers: { authorization: "Bearer one" },
    });
    expect(
      calendarRead.json().data.map((value: { id: string }) => value.id),
    ).toEqual([itemId]);
    const outsideRange = await server.inject({
      method: "GET",
      url: `/api/v1/items?from=${encodeURIComponent("2026-10-01T00:00:00Z")}&to=${encodeURIComponent("2026-10-01T23:59:59Z")}`,
      headers: { authorization: "Bearer one" },
    });
    expect(outsideRange.json().data).toEqual([]);
    const overlappingEdit = await server.inject({
      method: "PATCH",
      url: `/api/v1/items/${itemId}`,
      headers: {
        authorization: "Bearer one",
        "idempotency-key": randomUUID(),
        "if-match": "1",
      },
      payload: { title: "另一设备的标题" },
    });
    expect(overlappingEdit.statusCode).toBe(409);
    expect(overlappingEdit.json().error.code).toBe("VERSION_CONFLICT");
    const complete = await server.inject({
      method: "POST",
      url: `/api/v1/items/${itemId}/complete`,
      headers: {
        authorization: "Bearer one",
        "idempotency-key": randomUUID(),
        "if-match": "3",
      },
    });
    expect(complete.statusCode).toBe(200);
    expect(complete.json().data.status).toBe("COMPLETE");
    expect(complete.json().data.row_version).toBe(4);
    const sameCompletion = await server.inject({
      method: "POST",
      url: `/api/v1/items/${itemId}/complete`,
      headers: {
        authorization: "Bearer one",
        "idempotency-key": randomUUID(),
        "if-match": "1",
      },
    });
    expect(sameCompletion.statusCode).toBe(200);
    expect(sameCompletion.json().data.row_version).toBe(4);
    const conflict = await server.inject({
      method: "POST",
      url: `/api/v1/items/${itemId}/restore`,
      headers: {
        authorization: "Bearer one",
        "idempotency-key": randomUUID(),
        "if-match": "1",
      },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe("VERSION_CONFLICT");
    expect(conflict.json().error.details.conflict_id).toBeTypeOf("string");
    expect(
      (await db.query<{ count: string }>("SELECT count(*) FROM sync_conflicts"))
        .rows[0]?.count,
    ).toBe(2);
    const restore = await server.inject({
      method: "POST",
      url: `/api/v1/items/${itemId}/restore`,
      headers: {
        authorization: "Bearer one",
        "idempotency-key": randomUUID(),
        "if-match": "4",
      },
    });
    expect(restore.json().data.status).toBe("INCOMPLETE");
    expect(restore.json().data.row_version).toBe(5);
    const deleted = await server.inject({
      method: "DELETE",
      url: `/api/v1/items/${itemId}`,
      headers: {
        authorization: "Bearer one",
        "idempotency-key": randomUUID(),
        "if-match": "5",
      },
    });
    expect(deleted.statusCode).toBe(200);
    const token = deleted.json().data.undo_token as string;
    expect(token).toBeTypeOf("string");
    const hiddenAfterDelete = await server.inject({
      method: "GET",
      url: `/api/v1/items/${itemId}`,
      headers: { authorization: "Bearer one" },
    });
    expect(hiddenAfterDelete.statusCode).toBe(404);
    const badUndo = await server.inject({
      method: "POST",
      url: `/api/v1/items/${itemId}/undo-delete`,
      headers: {
        authorization: "Bearer one",
        "idempotency-key": randomUUID(),
        "x-undo-token": "wrong",
      },
    });
    expect(badUndo.statusCode).toBe(403);
    const undo = await server.inject({
      method: "POST",
      url: `/api/v1/items/${itemId}/undo-delete`,
      headers: {
        authorization: "Bearer one",
        "idempotency-key": randomUUID(),
        "x-undo-token": token,
      },
    });
    expect(undo.statusCode).toBe(200);
    expect(undo.json().data.id).toBe(itemId);
    expect(undo.json().data.deleted_at).toBeNull();
  } finally {
    await server.close();
    await db.close();
  }
});
