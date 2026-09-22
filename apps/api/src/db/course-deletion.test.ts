import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import { buildServer } from "../server.js";
import { CloudCourseManager, type CloudDatabase } from "./cloud.js";
import { CloudSync } from "./sync.js";

const firstOwner = "11111111-1111-4111-8111-111111111111";
const secondOwner = "22222222-2222-4222-8222-222222222222";

it("deletes a Course atomically with either explicit Item strategy and replays sync safely", async () => {
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
    sync: new CloudSync(port),
    verifyToken: async (token) =>
      token === "one" ? firstOwner : token === "two" ? secondOwner : null,
  });
  const request = (
    method: "GET" | "POST",
    url: string,
    payload?: object,
    key?: string,
    version?: number,
    token = "one",
  ) =>
    server.inject({
      method,
      url,
      headers: {
        authorization: `Bearer ${token}`,
        ...(key ? { "idempotency-key": key } : {}),
        ...(version ? { "if-match": String(version) } : {}),
      },
      payload,
    });
  async function courseWithItem(name: string) {
    const course = await request(
      "POST",
      "/api/v1/courses",
      { name, semester_id: null, instructor: null },
      randomUUID(),
    );
    expect(course.statusCode).toBe(200);
    const courseId = course.json().data.id as string;
    const item = await request(
      "POST",
      "/api/v1/items",
      {
        course_id: courseId,
        title: "准备讲稿",
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
    return { courseId, itemId: item.json().data.id as string };
  }
  try {
    const retained = await courseWithItem("统计学");
    const foreign = await request(
      "POST",
      `/api/v1/courses/${retained.courseId}/delete-with-strategy`,
      { strategy: "UNLINK_ASSOCIATED_ITEMS" },
      randomUUID(),
      1,
      "two",
    );
    expect(foreign.statusCode).toBe(404);
    const key = randomUUID();
    const unlinked = await request(
      "POST",
      `/api/v1/courses/${retained.courseId}/delete-with-strategy`,
      {
        strategy: "UNLINK_ASSOCIATED_ITEMS",
        item_versions: [{ id: retained.itemId, row_version: 1 }],
      },
      key,
      1,
    );
    expect(unlinked.statusCode).toBe(200);
    expect(unlinked.json().data.items[0]).toMatchObject({
      id: retained.itemId,
      course_id: null,
      deleted_at: null,
    });
    expect(
      (
        await request(
          "POST",
          `/api/v1/courses/${retained.courseId}/delete-with-strategy`,
          {
            strategy: "UNLINK_ASSOCIATED_ITEMS",
            item_versions: [{ id: retained.itemId, row_version: 1 }],
          },
          key,
          1,
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (await request("GET", `/api/v1/courses/${retained.courseId}`)).statusCode,
    ).toBe(404);
    expect(
      (await request("GET", `/api/v1/items/${retained.itemId}`)).json().data
        .course_id,
    ).toBeNull();

    const removed = await courseWithItem("经济法");
    const stale = await request(
      "POST",
      `/api/v1/courses/${removed.courseId}/delete-with-strategy`,
      { strategy: "DELETE_ASSOCIATED_ITEMS", item_versions: [] },
      randomUUID(),
      1,
    );
    expect(stale.statusCode).toBe(409);
    const deleted = await request(
      "POST",
      `/api/v1/courses/${removed.courseId}/delete-with-strategy`,
      {
        strategy: "DELETE_ASSOCIATED_ITEMS",
        item_versions: [{ id: removed.itemId, row_version: 1 }],
      },
      randomUUID(),
      1,
    );
    expect(deleted.statusCode).toBe(200);
    expect(
      (await request("GET", `/api/v1/items/${removed.itemId}`)).statusCode,
    ).toBe(404);

    const viaSync = await courseWithItem("线性代数");
    const mutation = {
      mutation_id: randomUUID(),
      entity_type: "COURSE",
      entity_id: viaSync.courseId,
      operation: "DELETE",
      base_version: 1,
      changed_fields: {
        strategy: "UNLINK_ASSOCIATED_ITEMS",
        deleted_at: "2026-09-22T09:00:00Z",
        item_versions: [{ id: viaSync.itemId, row_version: 1 }],
      },
    };
    const push = () =>
      request("POST", "/api/v1/sync/push", {
        device_id: randomUUID(),
        mutations: [mutation],
      });
    expect((await push()).json().data[0]).toMatchObject({
      result: "ACK",
      entity_version: 2,
    });
    expect((await push()).json().data[0]).toMatchObject({
      result: "ACK",
      entity_version: 2,
    });
    expect(
      (await request("GET", `/api/v1/items/${viaSync.itemId}`)).json().data
        .course_id,
    ).toBeNull();
  } finally {
    await server.close();
    await db.close();
  }
});
