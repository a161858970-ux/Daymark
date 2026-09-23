import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import { buildServer } from "../server.js";
import { CloudCourseManager, type CloudDatabase } from "./cloud.js";

const owner = "11111111-1111-4111-8111-111111111111";

it("covers Course update, CourseInformation writes, and symmetric ItemAssociation REST paths", async () => {
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
    verifyToken: async (token) => (token === "valid" ? owner : null),
  });
  const request = (
    method: string,
    url: string,
    payload?: object,
    version?: number,
  ) =>
    server.inject({
      method,
      url,
      headers: {
        authorization: "Bearer valid",
        ...(method === "GET" ? {} : { "idempotency-key": randomUUID() }),
        ...(version === undefined ? {} : { "if-match": String(version) }),
      },
      ...(payload ? { payload } : {}),
    });
  const itemInput = (title: string) => ({
    title,
    detail: null,
    course_id: null,
    status: "INCOMPLETE",
    start_at: null,
    occurrence_start_at: null,
    occurrence_end_at: null,
    due_at: null,
    reminder_level: "NORMAL",
    raw_capture_id: null,
  });
  try {
    const courseResponse = await request("POST", "/api/v1/courses", {
      name: "统计学",
      semester_id: null,
      instructor: null,
    });
    const course = courseResponse.json().data as {
      id: string;
      row_version: number;
    };
    const patched = await request(
      "PATCH",
      `/api/v1/courses/${course.id}`,
      { instructor: "陈老师" },
      course.row_version,
    );
    expect(patched.statusCode).toBe(200);
    expect(patched.json().data).toMatchObject({
      instructor: "陈老师",
      row_version: 2,
    });

    const createdInfo = await request(
      "POST",
      `/api/v1/courses/${course.id}/information`,
      { content: "教材第三版" },
    );
    expect(createdInfo.statusCode).toBe(200);
    const information = createdInfo.json().data as {
      id: string;
      row_version: number;
    };
    const revisedInfo = await request(
      "PATCH",
      `/api/v1/course-information/${information.id}`,
      { content: "教材第四版" },
      information.row_version,
    );
    expect(revisedInfo.json().data).toMatchObject({
      content: "教材第四版",
      row_version: 2,
    });

    const first = (
      await request("POST", "/api/v1/items", itemInput("演讲"))
    ).json().data as { id: string; row_version: number };
    const second = (
      await request("POST", "/api/v1/items", itemInput("准备幻灯片"))
    ).json().data as { id: string; row_version: number; status: string };
    const associationResponse = await request(
      "POST",
      "/api/v1/item-associations",
      { item_id_a: second.id, item_id_b: first.id },
    );
    expect(associationResponse.statusCode).toBe(200);
    const association = associationResponse.json().data as {
      id: string;
      item_id_a: string;
      item_id_b: string;
      row_version: number;
    };
    expect(association.item_id_a < association.item_id_b).toBe(true);
    const duplicate = await request("POST", "/api/v1/item-associations", {
      item_id_a: first.id,
      item_id_b: second.id,
    });
    expect(duplicate.json().data.id).toBe(association.id);
    const listed = await request(
      "GET",
      `/api/v1/items/${second.id}/associations`,
    );
    expect(listed.json().data.map((value: { id: string }) => value.id)).toEqual(
      [association.id],
    );
    const removed = await request(
      "DELETE",
      `/api/v1/item-associations/${association.id}`,
      undefined,
      association.row_version,
    );
    expect(removed.json().data.deleted_at).toBeTruthy();
    expect(
      (await request("GET", `/api/v1/items/${second.id}`)).json().data.status,
    ).toBe("INCOMPLETE");
    expect(
      (await request("GET", `/api/v1/items/${second.id}/associations`)).json()
        .data,
    ).toEqual([]);

    const removedInfo = await request(
      "DELETE",
      `/api/v1/course-information/${information.id}`,
      undefined,
      2,
    );
    expect(removedInfo.json().data.deleted_at).toBeTruthy();

    const capture = (
      await request("POST", "/api/v1/raw-captures", {
        source: "QUICK_CAPTURE",
        raw_text: "待确认原文",
        captured_at: "2026-09-24T00:00:00.000Z",
      })
    ).json().data as { id: string; row_version: number };
    const rawDelete = await request(
      "DELETE",
      `/api/v1/raw-captures/${capture.id}`,
      undefined,
      capture.row_version,
    );
    expect(rawDelete.statusCode).toBe(400);
    await db.query(
      "UPDATE raw_captures SET processing_status='UNRESOLVED',unresolved_reason='NEEDS_CLASSIFICATION',row_version=2 WHERE id=$1 AND owner_id=$2",
      [capture.id, owner],
    );
    const unresolvedDelete = await request(
      "DELETE",
      `/api/v1/raw-captures/${capture.id}`,
      undefined,
      2,
    );
    expect(unresolvedDelete.statusCode).toBe(200);
    expect(unresolvedDelete.json().data).toMatchObject({
      processing_status: "DELETED",
      row_version: 3,
    });
    expect(unresolvedDelete.json().data.deleted_at).toBeTruthy();
  } finally {
    await server.close();
    await db.close();
  }
});
