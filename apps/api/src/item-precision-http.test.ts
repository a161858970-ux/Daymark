import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import { buildServer } from "./server.js";
import { CloudDaymark, type CloudDatabase } from "./db/cloud.js";
import { CloudSync } from "./db/sync.js";
import { CloudConflictManager } from "./db/conflicts.js";

const ownerOne = "11111111-1111-4111-8111-111111111111";

async function setupHttp() {
  const db = new PGlite();
  for (const name of [
    "001_initial.sql",
    "002_collection_sync.sql",
    "007_date_precision.sql",
  ]) {
    const migration = fileURLToPath(
      new URL(`../../../backend/migrations/${name}`, import.meta.url),
    );
    await db.exec(await readFile(migration, "utf8"));
  }
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
    conflicts: new CloudConflictManager(port),
    verifyToken: async (token) => (token === "one" ? ownerOne : null),
  });
  return { db, server };
}

const auth = { authorization: "Bearer one" };

function postItem(
  server: ReturnType<typeof buildServer>,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
) {
  return server.inject({
    method: "POST",
    url: "/api/v1/items",
    headers: { ...auth, "idempotency-key": randomUUID(), ...headers },
    payload: body,
  });
}

function getItem(server: ReturnType<typeof buildServer>, id: string) {
  return server.inject({
    method: "GET",
    url: `/api/v1/items/${id}`,
    headers: auth,
  });
}

function patchItem(
  server: ReturnType<typeof buildServer>,
  id: string,
  version: number,
  body: Record<string, unknown>,
) {
  return server.inject({
    method: "PATCH",
    url: `/api/v1/items/${id}`,
    headers: {
      ...auth,
      "idempotency-key": randomUUID(),
      "if-match": String(version),
    },
    payload: body,
  });
}

const dateItemBody = {
  title: "交作业",
  detail: null,
  course_id: null,
  status: "INCOMPLETE",
  start_at: null,
  start_date: null,
  occurrence_start_at: null,
  occurrence_start_date: "2026-10-21",
  occurrence_end_at: null,
  occurrence_end_date: null,
  due_at: null,
  due_date: "2026-10-20",
  time_zone: "Asia/Shanghai",
  reminder_level: "NORMAL",
  raw_capture_id: null,
};

it("creates and reads DATE items over HTTP without fabricating clock values", async () => {
  const { db, server } = await setupHttp();
  try {
    const created = await postItem(server, dateItemBody);
    expect(created.statusCode, created.body).toBe(200);
    const data = created.json().data as Record<string, unknown>;
    expect(data).toMatchObject({
      due_date: "2026-10-20",
      due_at: null,
      occurrence_start_date: "2026-10-21",
      occurrence_start_at: null,
      occurrence_end_date: null,
      occurrence_end_at: null,
      start_date: null,
      start_at: null,
      time_zone: "Asia/Shanghai",
    });
    // Response DTO keeps every precision field — none may be dropped.
    for (const field of [
      "start_at",
      "start_date",
      "occurrence_start_at",
      "occurrence_start_date",
      "occurrence_end_at",
      "occurrence_end_date",
      "due_at",
      "due_date",
      "time_zone",
    ])
      expect(data, field).toHaveProperty(field);
    const fetched = await getItem(server, String(data.id));
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json().data).toMatchObject({
      due_date: "2026-10-20",
      due_at: null,
      occurrence_start_date: "2026-10-21",
      occurrence_start_at: null,
      time_zone: "Asia/Shanghai",
    });
  } finally {
    await server.close();
    await db.close();
  }
});

it("round-trips DATETIME items over HTTP with exact instants", async () => {
  const { db, server } = await setupHttp();
  try {
    const body = {
      ...dateItemBody,
      title: "小组展示",
      occurrence_start_at: "2026-10-21T01:00:00.000Z",
      occurrence_start_date: null,
      occurrence_end_at: "2026-10-21T03:00:00.000Z",
      occurrence_end_date: null,
      due_at: "2026-10-20T07:30:00.000Z",
      due_date: null,
    };
    const created = await postItem(server, body);
    expect(created.statusCode, created.body).toBe(200);
    const data = created.json().data as Record<string, unknown>;
    // Non-midnight instants must survive exactly (no midnight shifting).
    expect(new Date(String(data.due_at)).toISOString()).toBe(
      "2026-10-20T07:30:00.000Z",
    );
    expect(new Date(String(data.occurrence_start_at)).toISOString()).toBe(
      "2026-10-21T01:00:00.000Z",
    );
    expect(new Date(String(data.occurrence_end_at)).toISOString()).toBe(
      "2026-10-21T03:00:00.000Z",
    );
    expect(data.due_date).toBeNull();
    expect(data.occurrence_start_date).toBeNull();
    const fetched = await getItem(server, String(data.id));
    const roundTrip = fetched.json().data as Record<string, unknown>;
    expect(new Date(String(roundTrip.due_at)).toISOString()).toBe(
      "2026-10-20T07:30:00.000Z",
    );
    expect(new Date(String(roundTrip.occurrence_end_at)).toISOString()).toBe(
      "2026-10-21T03:00:00.000Z",
    );
  } finally {
    await server.close();
    await db.close();
  }
});

it("switches DATE and DATETIME through PATCH and enforces mutual exclusion", async () => {
  const { db, server } = await setupHttp();
  try {
    const created = await postItem(server, dateItemBody);
    expect(created.statusCode, created.body).toBe(200);
    const id = String((created.json().data as { id: string }).id);

    // DATE → DATETIME: the DATE side clears.
    const toDatetime = await patchItem(server, id, 1, {
      due_date: null,
      due_at: "2026-10-20T07:30:00.000Z",
    });
    expect(toDatetime.statusCode, toDatetime.body).toBe(200);
    let current = (await getItem(server, id)).json().data as Record<
      string,
      unknown
    >;
    expect(new Date(String(current.due_at)).toISOString()).toBe(
      "2026-10-20T07:30:00.000Z",
    );
    expect(current.due_date).toBeNull();

    // DATETIME → DATE: the DATETIME side clears.
    const toDate = await patchItem(server, id, Number(current.row_version), {
      due_at: null,
      due_date: "2026-10-20",
      time_zone: "Asia/Shanghai",
    });
    expect(toDate.statusCode, toDate.body).toBe(200);
    current = (await getItem(server, id)).json().data as Record<
      string,
      unknown
    >;
    expect(current.due_date).toBe("2026-10-20");
    expect(current.due_at).toBeNull();

    // Both sides of one endpoint in a single PATCH is rejected, item unchanged.
    const both = await patchItem(server, id, Number(current.row_version), {
      due_at: "2026-10-20T07:30:00.000Z",
      due_date: "2026-10-20",
    });
    expect(both.statusCode).toBe(400);
    expect(both.json().error.code).toBe("VALIDATION_ERROR");
    current = (await getItem(server, id)).json().data as Record<
      string,
      unknown
    >;
    expect(current.due_date).toBe("2026-10-20");
    expect(current.due_at).toBeNull();
  } finally {
    await server.close();
    await db.close();
  }
});

it("validates auth and precision fields consistently and keeps DATE data through sync push/pull", async () => {
  const { db, server } = await setupHttp();
  try {
    // Auth: missing and unknown tokens are refused with the product error DTO.
    const anonymous = await server.inject({
      method: "POST",
      url: "/api/v1/items",
      headers: { "idempotency-key": randomUUID() },
      payload: dateItemBody,
    });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json().error.code).toBe("AUTH_REQUIRED");
    const unknown = await postItem(server, dateItemBody, {
      authorization: "Bearer nope",
    });
    expect(unknown.statusCode).toBe(401);
    expect(unknown.json().error.code).toBe("AUTH_REQUIRED");

    // Request validation covers the new fields in both directions.
    const badShape = await postItem(server, {
      ...dateItemBody,
      due_date: "2026/10/20",
    });
    expect(badShape.statusCode).toBe(400);
    expect(badShape.json().error.code).toBe("VALIDATION_ERROR");
    const badCalendar = await postItem(server, {
      ...dateItemBody,
      due_date: "2026-13-45",
    });
    expect(badCalendar.statusCode).toBe(400);
    expect(badCalendar.json().error.code).toBe("VALIDATION_ERROR");

    // Sync push/pull over HTTP keeps DATE fields and raw capture text intact.
    const rawId = randomUUID();
    const itemId = randomUUID();
    const now = new Date().toISOString();
    const push = await server.inject({
      method: "POST",
      url: "/api/v1/sync/push",
      headers: auth,
      payload: {
        device_id: randomUUID(),
        mutations: [
          {
            mutation_id: randomUUID(),
            entity_type: "RAW_CAPTURE",
            entity_id: rawId,
            operation: "CREATE",
            base_version: null,
            changed_fields: {
              source: "QUICK_CAPTURE",
              raw_text: "2026年10月20日交作业",
              captured_at: "2026-10-09T02:00:00.000Z",
              captured_tz: "Asia/Shanghai",
            },
          },
          {
            mutation_id: randomUUID(),
            entity_type: "ITEM",
            entity_id: itemId,
            operation: "CREATE",
            base_version: null,
            changed_fields: {
              ...dateItemBody,
              raw_capture_id: rawId,
              created_at: now,
              updated_at: now,
            },
          },
        ],
      },
    });
    expect(push.statusCode, push.body).toBe(200);
    expect(push.json().data[0]).toMatchObject({ result: "ACK" });
    expect(push.json().data[1]).toMatchObject({ result: "ACK" });

    const changes = await server.inject({
      method: "GET",
      url: "/api/v1/sync/changes",
      headers: auth,
    });
    expect(changes.statusCode).toBe(200);
    const entries = changes.json().data as {
      entity_id: string;
      changed_fields: Record<string, unknown>;
    }[];
    const itemEntry = entries.find((entry) => entry.entity_id === itemId);
    expect(itemEntry?.changed_fields).toMatchObject({
      due_date: "2026-10-20",
      occurrence_start_date: "2026-10-21",
      time_zone: "Asia/Shanghai",
    });

    const fetched = await getItem(server, itemId);
    expect(fetched.json().data).toMatchObject({
      due_date: "2026-10-20",
      due_at: null,
      occurrence_start_date: "2026-10-21",
      time_zone: "Asia/Shanghai",
    });
    const raw = await server.inject({
      method: "GET",
      url: `/api/v1/raw-captures/${rawId}`,
      headers: auth,
    });
    expect(raw.statusCode).toBe(200);
    expect(raw.json().data.raw_text).toBe("2026年10月20日交作业");
    expect(raw.json().data.captured_tz).toBe("Asia/Shanghai");
  } finally {
    await server.close();
    await db.close();
  }
});
