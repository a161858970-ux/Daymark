import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import { buildServer } from "../server.js";
import { CloudCourseManager, type CloudDatabase } from "./cloud.js";
import { CloudNotificationManager } from "./notifications.js";

const owner = "11111111-1111-4111-8111-111111111111";
const otherOwner = "22222222-2222-4222-8222-222222222222";
const deviceA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const deviceB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

async function harness() {
  const postgres = new PGlite();
  for (const name of [
    "001_initial.sql",
    "002_collection_sync.sql",
    "003_course_import.sql",
    "004_reminder_delivery.sql",
    "005_schedule_times_nullable.sql",
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
  const notifications = new CloudNotificationManager(database);
  const server = buildServer({
    cloud,
    notifications,
    verifyToken: async (token) =>
      token === "owner" ? owner : token === "other" ? otherOwner : null,
  });
  return { postgres, cloud, notifications, server };
}

function request(
  server: Awaited<ReturnType<typeof harness>>["server"],
  url: string,
  payload?: object,
  token = "owner",
) {
  return server.inject({
    method: "POST",
    url,
    headers: { authorization: ["Bearer", token].join(" ") },
    payload,
  });
}

async function timedItem(cloud: Awaited<ReturnType<typeof harness>>["cloud"]) {
  return cloud.createItem(owner, randomUUID(), {
    title: "提交报告",
    detail: null,
    course_id: null,
    status: "INCOMPLETE",
    start_at: null,
    occurrence_start_at: null,
    occurrence_end_at: null,
    due_at: "2026-09-26T12:00:00.000Z",
    reminder_level: "NORMAL",
    raw_capture_id: null,
  });
}

const claimBody = (itemId: string, logicalKey: string, deviceId: string) => ({
  device_id: deviceId,
  logical_key: logicalKey,
  item_id: itemId,
  reminder_rule_key: "due:before:86400000",
  scheduled_for: "2026-09-26T00:00:00.000Z",
  policy_version: "fixture-v1",
});

it("registers devices and lets only one device hold a delivery lease", async () => {
  const { postgres, cloud, server } = await harness();
  try {
    const item = await timedItem(cloud);
    const key = `${item.id}:due:before:86400000:fixture-v1:2026-09-26T00:00:00.000Z`;

    const first = await request(server, "/api/v1/devices", {
      device_id: deviceA,
      platform: "WINDOWS",
    });
    expect(first.statusCode).toBe(200);

    const claimA = await request(
      server,
      "/api/v1/notifications/claim",
      claimBody(item.id, key, deviceA),
    );
    expect(claimA.statusCode, claimA.body).toBe(200);
    expect(claimA.json().data).toMatchObject({ claimed: true });
    const deliveryId = claimA.json().data.delivery_id as string;

    const claimAgain = await request(
      server,
      "/api/v1/notifications/claim",
      claimBody(item.id, key, deviceA),
    );
    expect(claimAgain.json().data).toMatchObject({
      claimed: true,
      delivery_id: deliveryId,
    });

    const claimB = await request(
      server,
      "/api/v1/notifications/claim",
      claimBody(item.id, key, deviceB),
    );
    expect(claimB.json().data).toMatchObject({
      claimed: false,
      reason: "LEASED",
    });

    const ack = await request(
      server,
      `/api/v1/notifications/${deliveryId}/delivered`,
      {
        device_id: deviceA,
      },
    );
    expect(ack.statusCode).toBe(200);
    expect(ack.json().data).toMatchObject({ delivered: true });

    const afterAck = await request(
      server,
      "/api/v1/notifications/claim",
      claimBody(item.id, key, deviceB),
    );
    expect(afterAck.json().data).toMatchObject({
      claimed: false,
      reason: "DELIVERED",
    });

    // Acknowledgement never changes Item state.
    expect((await cloud.getItem(owner, item.id))?.status).toBe("INCOMPLETE");
  } finally {
    await postgres.close();
  }
});

it("cancels a delivery server-side once the Item is completed, deleted or muted", async () => {
  const { postgres, cloud, server } = await harness();
  try {
    const item = await timedItem(cloud);
    const current = await cloud.getItem(owner, item.id);
    await cloud.setItemComplete(
      owner,
      item.id,
      randomUUID(),
      current!.row_version,
      true,
    );
    const key = `${item.id}:due:after:1:fixture-v1`;
    const claim = await request(
      server,
      "/api/v1/notifications/claim",
      claimBody(item.id, key, deviceA),
    );
    expect(claim.json().data).toMatchObject({
      claimed: false,
      reason: "STALE",
    });

    const rows = await postgres.query<{ state: string }>(
      "SELECT state FROM notification_deliveries WHERE owner_id=$1 AND logical_key=$2",
      [owner, key],
    );
    expect(rows.rows).toEqual([{ state: "CANCELED" }]);
  } finally {
    await postgres.close();
  }
});

it("cancels pending keys by name and keeps owner scope", async () => {
  const { postgres, cloud, server } = await harness();
  try {
    const item = await timedItem(cloud);
    const key = `${item.id}:due:after:2:fixture-v1`;
    const claim = await request(
      server,
      "/api/v1/notifications/claim",
      claimBody(item.id, key, deviceA),
    );
    expect(claim.json().data.claimed).toBe(true);

    const cancel = await request(server, "/api/v1/notifications/cancel", {
      logical_keys: [key],
    });
    expect(cancel.json().data).toEqual({ canceled: 1 });

    const again = await request(
      server,
      "/api/v1/notifications/claim",
      claimBody(item.id, key, deviceA),
    );
    expect(again.json().data).toMatchObject({
      claimed: false,
      reason: "CANCELED",
    });

    const foreign = await request(
      server,
      "/api/v1/notifications/cancel",
      { logical_keys: [key] },
      "other",
    );
    expect(foreign.json().data).toEqual({ canceled: 0 });
  } finally {
    await postgres.close();
  }
});

it("requires authentication for device and notification routes", async () => {
  const { postgres, server } = await harness();
  try {
    const anonymous = await server.inject({
      method: "POST",
      url: "/api/v1/notifications/claim",
      payload: claimBody(randomUUID(), "some-key", deviceA),
    });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json().error.code).toBe("AUTH_REQUIRED");
  } finally {
    await postgres.close();
  }
});
