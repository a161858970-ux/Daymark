import "fake-indexeddb/auto";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import { Daymark, SyncWorker, type SyncTransport } from "@daymark/application";
import { DaymarkDb, DexieLocalRepository } from "@daymark/storage";
import { buildServer } from "../server.js";
import { CloudDaymark, type CloudDatabase } from "./cloud.js";
import { CloudSync } from "./sync.js";
import { CloudConflictManager } from "./conflicts.js";

const ownerId = "11111111-1111-4111-8111-111111111111";

it("round-trips local capture through authenticated API without changing Item identity", async () => {
  const postgres = new PGlite();
  const migration = fileURLToPath(
    new URL("../../../../backend/migrations/001_initial.sql", import.meta.url),
  );
  await postgres.exec(await readFile(migration, "utf8"));
  const collectionMigration = fileURLToPath(
    new URL(
      "../../../../backend/migrations/002_collection_sync.sql",
      import.meta.url,
    ),
  );
  await postgres.exec(await readFile(collectionMigration, "utf8"));
  const datePrecisionMigration = fileURLToPath(
    new URL(
      "../../../../backend/migrations/007_date_precision.sql",
      import.meta.url,
    ),
  );
  await postgres.exec(await readFile(datePrecisionMigration, "utf8"));
  const port: CloudDatabase = {
    query: async (sql, params) => postgres.query(sql, params),
    transaction: (work) =>
      postgres.transaction((tx) =>
        work({ query: async (sql, params) => tx.query(sql, params) }),
      ),
  };
  const server = buildServer({
    cloud: new CloudDaymark(port),
    sync: new CloudSync(port),
    conflicts: new CloudConflictManager(port),
    verifyToken: async (token) =>
      token === "valid"
        ? ownerId
        : token === "other"
          ? "22222222-2222-4222-8222-222222222222"
          : null,
  });
  const local = new DaymarkDb(`sync-roundtrip-${randomUUID()}`);
  const repo = new DexieLocalRepository(local);
  const manager = new Daymark(repo);
  try {
    const semester = await manager.createSemester(
      "2026 秋季学期",
      "2026-09-01",
      "2026-12-31",
    );
    const weeks = await manager.replaceSemesterWeeks(semester.id, [
      { week_number: 1, start_date: "2026-09-01", end_date: "2026-09-06" },
    ]);
    const course = await manager.createCourse("环境经济学", semester.id);
    const capture = await manager.capture(
      "找学姐要笔记",
      "COURSE_ITEM",
      course.id,
    );
    const item = await manager.processClearCapture(capture.id);
    expect(item?.id).toBeTruthy();
    const transport: SyncTransport = {
      identity: async () => {
        const response = await server.inject({
          method: "GET",
          url: "/api/v1/sync/identity",
          headers: { authorization: "Bearer valid" },
        });
        if (response.statusCode !== 200) throw new Error(response.body);
        return response.json().data.owner_id;
      },
      push: async (deviceId, mutation) => {
        const response = await server.inject({
          method: "POST",
          url: "/api/v1/sync/push",
          headers: { authorization: "Bearer valid" },
          payload: { device_id: deviceId, mutations: [mutation] },
        });
        if (response.statusCode !== 200) throw new Error(response.body);
        return response.json().data[0];
      },
      changes: async (cursor) => {
        const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
        const response = await server.inject({
          method: "GET",
          url: `/api/v1/sync/changes${query}`,
          headers: { authorization: "Bearer valid" },
        });
        if (response.statusCode !== 200) throw new Error(response.body);
        return { data: response.json().data, ...response.json().meta };
      },
    };
    const worker = new SyncWorker(repo, transport);
    const first = await worker.runOnce();
    expect(first).toMatchObject({ pushed: 7, pulled: 7, stopped: null });
    expect((await repo.getSemester(semester.id))?.id).toBe(semester.id);
    expect((await repo.listSemesterWeeks(semester.id))[0]?.id).toBe(
      weeks[0]?.id,
    );
    expect((await repo.getItem(item!.id))?.id).toBe(item!.id);
    expect((await repo.getRawCapture(capture.id))?.raw_text).toBe(
      "找学姐要笔记",
    );
    expect(
      (await postgres.query<{ id: string }>("SELECT id FROM items")).rows[0]
        ?.id,
    ).toBe(item!.id);
    expect(await repo.pendingMutations()).toHaveLength(0);

    const remoteEdit = await server.inject({
      method: "PATCH",
      url: `/api/v1/items/${item!.id}`,
      headers: {
        authorization: "Bearer valid",
        "idempotency-key": randomUUID(),
        "if-match": "1",
      },
      payload: { title: "找学姐要课程笔记" },
    });
    expect(remoteEdit.statusCode).toBe(200);
    const second = await worker.runOnce();
    expect(second).toMatchObject({ pushed: 0, pulled: 1, stopped: null });
    expect((await repo.getItem(item!.id))?.title).toBe("找学姐要课程笔记");
    expect((await repo.getItem(item!.id))?.id).toBe(item!.id);

    await manager.updateItem(item!.id, { title: "本地修改" });
    const otherDeviceEdit = await server.inject({
      method: "PATCH",
      url: `/api/v1/items/${item!.id}`,
      headers: {
        authorization: "Bearer valid",
        "idempotency-key": randomUUID(),
        "if-match": "2",
      },
      payload: { title: "另一设备修改" },
    });
    expect(otherDeviceEdit.statusCode).toBe(200);
    const conflict = await worker.runOnce();
    expect(conflict.stopped).toBe("VERSION_CONFLICT");
    expect(await repo.pendingMutations()).toHaveLength(1);
    expect((await repo.getItem(item!.id))?.title).toBe("本地修改");
    const remote = await server.inject({
      method: "GET",
      url: `/api/v1/items/${item!.id}`,
      headers: { authorization: "Bearer valid" },
    });
    expect(remote.json().data.title).toBe("另一设备修改");
    const storedConflict = await postgres.query<{
      local_version: { title: string };
      remote_version: { title: string };
      conflicting_fields: string[];
    }>(
      "SELECT local_version, remote_version, conflicting_fields FROM sync_conflicts WHERE entity_id = $1",
      [item!.id],
    );
    expect(storedConflict.rows[0]).toMatchObject({
      local_version: { title: "本地修改" },
      remote_version: { title: "另一设备修改" },
      conflicting_fields: ["title"],
    });
    const open = await server.inject({
      method: "GET",
      url: "/api/v1/sync/conflicts",
      headers: { authorization: "Bearer valid" },
    });
    expect(open.statusCode).toBe(200);
    expect(open.json().data).toHaveLength(1);
    const conflictId = open.json().data[0].id as string;
    const inaccessible = await server.inject({
      method: "GET",
      url: `/api/v1/sync/conflicts/${conflictId}`,
      headers: { authorization: "Bearer other" },
    });
    expect(inaccessible.statusCode).toBe(404);
    const detail = await server.inject({
      method: "GET",
      url: `/api/v1/sync/conflicts/${conflictId}`,
      headers: { authorization: "Bearer valid" },
    });
    expect(detail.json().data.current_entity.title).toBe("另一设备修改");
    const invalidChoice = await server.inject({
      method: "POST",
      url: `/api/v1/sync/conflicts/${conflictId}/resolve`,
      headers: {
        authorization: "Bearer valid",
        "idempotency-key": randomUUID(),
        "if-match": "3",
      },
      payload: {
        strategy: "USE_LOCAL",
        field_resolutions: { title: "REMOTE" },
      },
    });
    expect(invalidChoice.statusCode).toBe(400);
    const missingExplicitValue = await server.inject({
      method: "POST",
      url: `/api/v1/sync/conflicts/${conflictId}/resolve`,
      headers: {
        authorization: "Bearer valid",
        "idempotency-key": randomUUID(),
        "if-match": "3",
      },
      payload: {
        strategy: "USE_EXPLICIT_VALUE",
        field_resolutions: { title: {} },
      },
    });
    expect(missingExplicitValue.statusCode).toBe(400);
    const stale = await server.inject({
      method: "POST",
      url: `/api/v1/sync/conflicts/${conflictId}/resolve`,
      headers: {
        authorization: "Bearer valid",
        "idempotency-key": randomUUID(),
        "if-match": "2",
      },
      payload: {
        strategy: "USE_LOCAL",
        field_resolutions: { title: "LOCAL" },
      },
    });
    expect(stale.statusCode).toBe(409);
    const resolutionKey = randomUUID();
    const resolved = await server.inject({
      method: "POST",
      url: `/api/v1/sync/conflicts/${conflictId}/resolve`,
      headers: {
        authorization: "Bearer valid",
        "idempotency-key": resolutionKey,
        "if-match": "3",
      },
      payload: {
        strategy: "USE_LOCAL",
        field_resolutions: { title: "LOCAL" },
      },
    });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json().data).toMatchObject({
      conflict: { id: conflictId, status: "RESOLVED" },
      entity: { id: item!.id, title: "本地修改", row_version: 4 },
    });
    const replay = await server.inject({
      method: "POST",
      url: `/api/v1/sync/conflicts/${conflictId}/resolve`,
      headers: {
        authorization: "Bearer valid",
        "idempotency-key": resolutionKey,
        "if-match": "3",
      },
      payload: {
        strategy: "USE_LOCAL",
        field_resolutions: { title: "LOCAL" },
      },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().data.entity.row_version).toBe(4);
    expect(
      (
        await server.inject({
          method: "GET",
          url: "/api/v1/sync/conflicts",
          headers: { authorization: "Bearer valid" },
        })
      ).json().data,
    ).toHaveLength(0);
    await repo.acceptResolvedConflict(
      resolved.json().data.conflict,
      resolved.json().data.entity,
    );
    expect(await repo.pendingMutations()).toHaveLength(0);
    expect((await repo.getItem(item!.id))?.title).toBe("本地修改");
    expect(await repo.serverVersion("ITEM", item!.id)).toBe(4);
    expect(await worker.runOnce()).toMatchObject({
      pushed: 0,
      pulled: 2,
      stopped: null,
    });
    expect((await repo.getItem(item!.id))?.title).toBe("本地修改");
    const localDelete = await manager.deleteItem(item!.id);
    const simultaneousEdit = await server.inject({
      method: "PATCH",
      url: `/api/v1/items/${item!.id}`,
      headers: {
        authorization: "Bearer valid",
        "idempotency-key": randomUUID(),
        "if-match": "4",
      },
      payload: { title: "删除前的另一设备修改" },
    });
    expect(simultaneousEdit.statusCode).toBe(200);
    expect((await worker.runOnce()).stopped).toBe("VERSION_CONFLICT");
    const deleteConflict = (
      await server.inject({
        method: "GET",
        url: "/api/v1/sync/conflicts",
        headers: { authorization: "Bearer valid" },
      })
    ).json().data[0];
    expect(deleteConflict.local_version.deleted_at).toBe("DELETE");
    const keepDeletion = await server.inject({
      method: "POST",
      url: `/api/v1/sync/conflicts/${deleteConflict.id}/resolve`,
      headers: {
        authorization: "Bearer valid",
        "idempotency-key": randomUUID(),
        "if-match": "5",
      },
      payload: {
        strategy: "USE_LOCAL",
        field_resolutions: { deleted_at: "LOCAL" },
      },
    });
    expect(keepDeletion.statusCode).toBe(200);
    expect(keepDeletion.json().data.undo_token).toBe(localDelete.token);
    await repo.acceptResolvedConflict(
      keepDeletion.json().data.conflict,
      keepDeletion.json().data.entity,
    );
    expect((await repo.getItem(item!.id))?.deleted_at).toBeTruthy();
    await manager.undoDelete(item!.id, localDelete.token);
    expect(await worker.runOnce()).toMatchObject({
      pushed: 1,
      stopped: null,
    });
    expect((await repo.getItem(item!.id))?.deleted_at).toBeNull();
  } finally {
    await server.close();
    local.close();
    await local.delete();
    await postgres.close();
  }
});
