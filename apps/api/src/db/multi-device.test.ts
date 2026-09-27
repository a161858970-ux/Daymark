import "fake-indexeddb/auto";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, expect, it } from "vitest";
import {
  CourseManager,
  SyncWorker,
  type SyncTransport,
} from "@course-manager/application";
import { CourseManagerDb, DexieLocalRepository } from "@course-manager/storage";
import { buildServer } from "../server.js";
import { CloudCourseManager, type CloudDatabase } from "./cloud.js";
import { CloudConflictManager } from "./conflicts.js";
import { CloudSync } from "./sync.js";

const owner = "11111111-1111-4111-8111-111111111111";
const localDbs: CourseManagerDb[] = [];

afterEach(async () => {
  for (const db of localDbs.splice(0)) {
    db.close();
    await db.delete();
  }
});

async function harness() {
  const postgres = new PGlite();
  for (const name of ["001_initial.sql", "002_collection_sync.sql"]) {
    const path = fileURLToPath(
      new URL(`../../../../backend/migrations/${name}`, import.meta.url),
    );
    await postgres.exec(await readFile(path, "utf8"));
  }
  const port: CloudDatabase = {
    query: async (sql, params) => postgres.query(sql, params),
    transaction: (work) =>
      postgres.transaction((tx) =>
        work({ query: async (sql, params) => tx.query(sql, params) }),
      ),
  };
  const conflicts = new CloudConflictManager(port);
  const server = buildServer({
    cloud: new CloudCourseManager(port),
    sync: new CloudSync(port),
    conflicts,
    verifyToken: async () => owner,
  });
  const transport = (): SyncTransport => ({
    identity: async () => owner,
    push: async (deviceId, mutation) => {
      const response = await server.inject({
        method: "POST",
        url: "/api/v1/sync/push",
        headers: { authorization: "Bearer test" },
        payload: { device_id: deviceId, mutations: [mutation] },
      });
      const body = response.json();
      if (response.statusCode !== 200)
        throw Object.assign(new Error(body.error?.message ?? response.body), {
          code: body.error?.code,
        });
      return body.data[0];
    },
    changes: async (cursor) => {
      const response = await server.inject({
        method: "GET",
        url: `/api/v1/sync/changes${
          cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""
        }`,
        headers: { authorization: "Bearer test" },
      });
      const body = response.json();
      if (response.statusCode !== 200)
        throw Object.assign(new Error(body.error?.message ?? response.body), {
          code: body.error?.code,
        });
      return { data: body.data, ...body.meta };
    },
  });
  const local = () => {
    const db = new CourseManagerDb(`device-${randomUUID()}`);
    localDbs.push(db);
    const repo = new DexieLocalRepository(db);
    return {
      db,
      repo,
      manager: new CourseManager(repo),
      worker: new SyncWorker(repo, transport()),
    };
  };
  return { postgres, server, conflicts, transport, local };
}

it("A-G: two devices converge through create, merge, conflict, resolution, delete competition, and expired Undo", async () => {
  const { postgres, server, conflicts, local } = await harness();
  const a = local();
  const b = local();
  try {
    // A — Device A creates offline; server and Device B see nothing until A reconnects.
    const raw = await a.manager.capture("提交报告");
    const item = await a.manager.processClearCapture(raw.id);
    expect(item && "status" in item ? item : null).toBeTruthy();
    expect(await b.manager.listItems()).toEqual([]);
    expect((await a.worker.runOnce()).stopped).toBeNull();
    expect((await b.worker.runOnce()).stopped).toBeNull();
    expect((await b.manager.getItem(item!.id))?.id).toBe(item!.id);

    // B — Changes to different fields merge without a user decision.
    await a.manager.updateItem(item!.id, { title: "A 的标题" });
    await b.manager.updateItem(item!.id, { detail: "B 的补充" });
    expect((await a.worker.runOnce()).stopped).toBeNull();
    expect((await b.worker.runOnce()).stopped).toBeNull();
    expect((await a.worker.runOnce()).stopped).toBeNull();
    expect(await a.manager.getItem(item!.id)).toMatchObject({
      title: "A 的标题",
      detail: "B 的补充",
    });
    expect(await b.manager.getItem(item!.id)).toMatchObject({
      title: "A 的标题",
      detail: "B 的补充",
    });

    // C — Concurrent edits to the same field form an explicit conflict.
    await a.manager.updateItem(item!.id, { title: "A 再次修改" });
    await b.manager.updateItem(item!.id, { title: "B 再次修改" });
    expect((await a.worker.runOnce()).stopped).toBeNull();
    expect((await b.worker.runOnce()).stopped).toBe("VERSION_CONFLICT");
    const rejected = (await b.repo.pendingMutations())[0]!;
    const conflictId = rejected.last_error!.split(":")[1]!;
    const detail = await conflicts.get(owner, conflictId);
    expect(detail.conflict.conflicting_fields).toEqual(["title"]);

    // D — Choosing B's local value resolves the conflict and both devices converge.
    const resolved = await conflicts.resolve(
      owner,
      conflictId,
      randomUUID(),
      Number(detail.current_entity.row_version),
      {
        strategy: "USE_LOCAL",
        field_resolutions: { title: "LOCAL" },
      },
    );
    await b.repo.acceptResolvedConflict(resolved.conflict, resolved.entity);
    expect((await a.worker.runOnce()).stopped).toBeNull();
    expect((await b.worker.runOnce()).stopped).toBeNull();
    expect((await a.manager.getItem(item!.id))?.title).toBe("B 再次修改");
    expect((await b.manager.getItem(item!.id))?.title).toBe("B 再次修改");

    // E — A new local edit immediately after resolution uses the resolved version.
    await b.manager.updateItem(item!.id, { detail: "解决后立即补充" });
    expect((await b.worker.runOnce()).stopped).toBeNull();
    expect((await a.worker.runOnce()).stopped).toBeNull();
    expect((await a.manager.getItem(item!.id))?.detail).toBe("解决后立即补充");

    // F — Delete versus edit becomes an explicit conflict; deletion cannot be bypassed.
    await b.manager.updateItem(item!.id, { title: "删除同时的编辑" });
    const deletion = await a.manager.deleteItem(item!.id);
    expect((await a.worker.runOnce()).stopped).toBeNull();
    expect((await b.worker.runOnce()).stopped).toBe("VERSION_CONFLICT");
    const deleteConflictMutation = (await b.repo.pendingMutations())[0]!;
    const deleteConflictId = deleteConflictMutation.last_error!.split(":")[1]!;
    const deleteDetail = await conflicts.get(owner, deleteConflictId);
    expect(deleteDetail.current_entity.deleted_at).toBeTruthy();
    const keptDeletion = await conflicts.resolve(
      owner,
      deleteConflictId,
      randomUUID(),
      Number(deleteDetail.current_entity.row_version),
      {
        strategy: "USE_REMOTE",
        field_resolutions: { title: "REMOTE" },
      },
    );
    await b.repo.acceptResolvedConflict(
      keptDeletion.conflict,
      keptDeletion.entity,
    );
    expect((await a.worker.runOnce()).stopped).toBeNull();
    expect((await a.manager.getItem(item!.id))?.deleted_at).toBeTruthy();
    expect((await b.manager.getItem(item!.id))?.deleted_at).toBeTruthy();

    // G — An expired token leaves the restored local object repairable, never silently undeletes.
    await postgres.query(
      "UPDATE delete_undo_tokens SET expires_at='2000-01-01T00:00:00Z' WHERE owner_id=$1 AND item_id=$2",
      [owner, item!.id],
    );
    await a.manager.undoDelete(item!.id, deletion.token);
    expect((await a.worker.runOnce()).stopped).toBe("ACTION_REQUIRED");
    const issue = (await a.repo.listActionRequiredIssues())[0]!;
    expect(issue).toMatchObject({
      error_code: "FORBIDDEN",
      can_retry: false,
      can_abandon: true,
    });
    await a.repo.abandonActionRequired(issue.mutation.mutation_id);
    expect((await a.worker.runOnce()).stopped).toBeNull();
    expect((await a.manager.getItem(item!.id))?.deleted_at).toBeTruthy();
  } finally {
    await server.close();
    await postgres.close();
  }
});

it("H: two devices resolve a whole CourseSchedule replacement without partial rows", async () => {
  const { postgres, server, conflicts, local } = await harness();
  const a = local();
  const b = local();
  try {
    const course = await a.manager.createCourse("同步课表课程", null);
    expect((await a.worker.runOnce()).stopped).toBeNull();
    expect((await b.worker.runOnce()).stopped).toBeNull();

    const [aSchedule] = await a.manager.replaceCourseSchedules(course.id, [
      {
        weekday: 2,
        start_time: "09:00",
        end_time: "10:30",
        week_start: 1,
        week_end: 12,
        classroom: "A101",
        stage_label: null,
      },
    ]);
    const [bSchedule] = await b.manager.replaceCourseSchedules(course.id, [
      {
        weekday: 4,
        start_time: "14:00",
        end_time: "15:30",
        week_start: 1,
        week_end: 12,
        classroom: "B202",
        stage_label: null,
      },
    ]);
    expect((await a.worker.runOnce()).stopped).toBeNull();
    expect((await b.worker.runOnce()).stopped).toBe("VERSION_CONFLICT");

    const rejected = (await b.repo.pendingMutations()).find(
      (mutation) => mutation.entity_type === "COURSE_SCHEDULE_COLLECTION",
    )!;
    const conflictId = rejected.last_error!.split(":")[1]!;
    const detail = await conflicts.get(owner, conflictId);
    expect(detail.conflict.conflicting_fields).toEqual(["collection"]);
    expect(detail.current_entity.collection).toMatchObject([
      { id: aSchedule!.id },
    ]);
    const resolved = await conflicts.resolve(
      owner,
      conflictId,
      randomUUID(),
      Number(detail.current_entity.row_version),
      {
        strategy: "USE_LOCAL",
        field_resolutions: { collection: "LOCAL" },
      },
    );
    await b.repo.acceptResolvedConflict(resolved.conflict, resolved.entity);
    expect((await a.worker.runOnce()).stopped).toBeNull();
    expect((await b.worker.runOnce()).stopped).toBeNull();
    expect(
      (await a.manager.courseSchedules(course.id)).map(({ id }) => id),
    ).toEqual([bSchedule!.id]);
    expect(
      (await b.manager.courseSchedules(course.id)).map(({ id }) => id),
    ).toEqual([bSchedule!.id]);
    const live = await postgres.query<{ id: string }>(
      "SELECT id FROM course_schedules WHERE course_id=$1 AND deleted_at IS NULL",
      [course.id],
    );
    expect(live.rows).toEqual([{ id: bSchedule!.id }]);
  } finally {
    await server.close();
    await postgres.close();
  }
});

it("I: two devices resolve a SemesterWeek replacement as one collection", async () => {
  const { postgres, server, conflicts, local } = await harness();
  const a = local();
  const b = local();
  try {
    const semester = await a.manager.createSemester(
      "2026 秋季同步学期",
      "2026-09-01",
      "2026-12-31",
    );
    expect((await a.worker.runOnce()).stopped).toBeNull();
    expect((await b.worker.runOnce()).stopped).toBeNull();

    const [aWeek] = await a.manager.replaceSemesterWeeks(semester.id, [
      {
        week_number: 1,
        start_date: "2026-09-01",
        end_date: "2026-09-07",
      },
    ]);
    const [bWeek] = await b.manager.replaceSemesterWeeks(semester.id, [
      {
        week_number: 1,
        start_date: "2026-09-02",
        end_date: "2026-09-08",
      },
    ]);
    expect((await a.worker.runOnce()).stopped).toBeNull();
    expect((await b.worker.runOnce()).stopped).toBe("VERSION_CONFLICT");

    const rejected = (await b.repo.pendingMutations()).find(
      (mutation) => mutation.entity_type === "SEMESTER_WEEK_COLLECTION",
    )!;
    const conflictId = rejected.last_error!.split(":")[1]!;
    const detail = await conflicts.get(owner, conflictId);
    expect(detail.conflict.conflicting_fields).toEqual(["collection"]);
    const resolved = await conflicts.resolve(
      owner,
      conflictId,
      randomUUID(),
      Number(detail.current_entity.row_version),
      {
        strategy: "USE_REMOTE",
        field_resolutions: { collection: "REMOTE" },
      },
    );
    await b.repo.acceptResolvedConflict(resolved.conflict, resolved.entity);
    expect((await a.worker.runOnce()).stopped).toBeNull();
    expect((await b.worker.runOnce()).stopped).toBeNull();
    expect(
      (await a.manager.semesterWeeks(semester.id)).map(({ id }) => id),
    ).toEqual([aWeek!.id]);
    expect(
      (await b.manager.semesterWeeks(semester.id)).map(({ id }) => id),
    ).toEqual([aWeek!.id]);
    expect(bWeek!.id).not.toBe(aWeek!.id);
    const live = await postgres.query<{ id: string }>(
      "SELECT id FROM semester_weeks WHERE semester_id=$1",
      [semester.id],
    );
    expect(live.rows).toEqual([{ id: aWeek!.id }]);
  } finally {
    await server.close();
    await postgres.close();
  }
});

it("K: a committed mutation with a lost response retries the same ID without duplicates", async () => {
  const { postgres, server, transport, local } = await harness();
  const device = local();
  const sent: string[] = [];
  let drop = true;
  const underlying = transport();
  const lossy: SyncTransport = {
    ...underlying,
    push: async (deviceId, mutation) => {
      sent.push(mutation.mutation_id);
      const result = await underlying.push(deviceId, mutation);
      if (drop) {
        drop = false;
        throw new Error("response lost after commit");
      }
      return result;
    },
  };
  const worker = new SyncWorker(device.repo, lossy);
  try {
    const raw = await device.manager.capture("提交报告");
    await device.manager.processClearCapture(raw.id);
    expect((await worker.runOnce()).stopped).toBe("RETRY");
    expect((await worker.runOnce()).stopped).toBeNull();
    expect(sent[0]).toBe(sent[1]);
    expect(
      Number(
        (
          await postgres.query<{ count: string | number }>(
            "SELECT count(*) FROM raw_captures",
          )
        ).rows[0]?.count,
      ),
    ).toBe(1);
    expect(
      Number(
        (
          await postgres.query<{ count: string | number }>(
            "SELECT count(*) FROM items",
          )
        ).rows[0]?.count,
      ),
    ).toBe(1);
  } finally {
    await server.close();
    await postgres.close();
  }
});

it("T-SYNC-005..008 covers concurrent complete, due conflict, safe merge, and tombstone propagation", async () => {
  const { postgres, server, conflicts, local } = await harness();
  const a = local();
  const b = local();

  async function createShared(text: string) {
    const raw = await a.manager.capture(text);
    const item = await a.manager.processClearCapture(raw.id);
    expect((await a.worker.runOnce()).stopped).toBeNull();
    expect((await b.worker.runOnce()).stopped).toBeNull();
    return item!;
  }

  try {
    const completed = await createShared("提交同步验收报告");
    await a.manager.completeItem(completed.id);
    await b.manager.completeItem(completed.id);
    expect((await a.worker.runOnce()).stopped).toBeNull();
    expect((await b.worker.runOnce()).stopped).toBeNull();
    expect((await a.worker.runOnce()).stopped).toBeNull();
    expect((await b.worker.runOnce()).stopped).toBeNull();
    expect((await a.manager.getItem(completed.id))?.status).toBe("COMPLETE");
    expect((await b.manager.getItem(completed.id))?.status).toBe("COMPLETE");
    expect(await conflicts.list(owner)).toEqual([]);

    const conflicting = await createShared("准备冲突验收");
    await a.manager.updateItem(conflicting.id, {
      due_at: "2026-09-30T12:00:00.000Z",
    });
    await b.manager.updateItem(conflicting.id, {
      due_at: "2026-10-01T12:00:00.000Z",
    });
    expect((await a.worker.runOnce()).stopped).toBeNull();
    expect((await b.worker.runOnce()).stopped).toBe("VERSION_CONFLICT");
    const rejected = (await b.repo.pendingMutations())[0]!;
    const conflictId = rejected.last_error!.split(":")[1]!;
    const dueConflict = await conflicts.get(owner, conflictId);
    expect(dueConflict.conflict.conflicting_fields).toEqual(["due_at"]);
    const keptRemote = await conflicts.resolve(
      owner,
      conflictId,
      randomUUID(),
      Number(dueConflict.current_entity.row_version),
      {
        strategy: "USE_REMOTE",
        field_resolutions: { due_at: "REMOTE" },
      },
    );
    await b.repo.acceptResolvedConflict(keptRemote.conflict, keptRemote.entity);
    expect((await b.worker.runOnce()).stopped).toBeNull();

    const merged = await createShared("准备安全合并验收");
    await a.manager.updateItem(merged.id, {
      due_at: "2026-10-05T12:00:00.000Z",
    });
    await b.manager.updateItem(merged.id, { detail: "携带课堂讲义" });
    expect((await a.worker.runOnce()).stopped).toBeNull();
    expect((await b.worker.runOnce()).stopped).toBeNull();
    expect((await a.worker.runOnce()).stopped).toBeNull();
    expect(await a.manager.getItem(merged.id)).toMatchObject({
      due_at: "2026-10-05T12:00:00.000Z",
      detail: "携带课堂讲义",
    });
    expect(await b.manager.getItem(merged.id)).toMatchObject({
      due_at: "2026-10-05T12:00:00.000Z",
      detail: "携带课堂讲义",
    });

    const removed = await createShared("准备删除传播验收");
    await a.manager.deleteItem(removed.id);
    expect((await a.worker.runOnce()).stopped).toBeNull();
    expect((await b.worker.runOnce()).stopped).toBeNull();
    expect((await b.manager.getItem(removed.id))?.deleted_at).toBeTruthy();
    expect((await b.manager.listItems()).map((item) => item.id)).not.toContain(
      removed.id,
    );
  } finally {
    await server.close();
    await postgres.close();
  }
});

it("resolution keeps the rejected push's non-conflicting fields", async () => {
  const { postgres, server, conflicts, local } = await harness();
  const a = local();
  const b = local();
  try {
    const raw = await a.manager.capture("提交周报");
    const item = await a.manager.processClearCapture(raw.id);
    if (!item) throw new Error("expected a parsed item");
    expect((await a.worker.runOnce()).stopped).toBeNull();
    expect((await b.worker.runOnce()).stopped).toBeNull();

    // A changes the title first; B then changes the same title plus an
    // unrelated field in one edit, so only the title overlaps.
    await a.manager.updateItem(item.id, { title: "A 的标题" });
    expect((await a.worker.runOnce()).stopped).toBeNull();
    await b.manager.updateItem(item.id, {
      title: "B 的标题",
      detail: "B 的补充",
    });
    expect((await b.worker.runOnce()).stopped).toBe("VERSION_CONFLICT");

    const rejected = (await b.repo.pendingMutations())[0]!;
    const conflictId = rejected.last_error!.split(":")[1]!;
    const detail = await conflicts.get(owner, conflictId);
    expect(detail.conflict.conflicting_fields).toEqual(["title"]);

    const resolved = await conflicts.resolve(
      owner,
      conflictId,
      randomUUID(),
      Number(detail.current_entity.row_version),
      {
        strategy: "USE_LOCAL",
        field_resolutions: { title: "LOCAL" },
      },
    );
    // The non-overlapping half of the rejected edit must not be discarded.
    expect(resolved.entity).toMatchObject({
      title: "B 的标题",
      detail: "B 的补充",
    });

    await b.repo.acceptResolvedConflict(resolved.conflict, resolved.entity);
    expect((await a.worker.runOnce()).stopped).toBeNull();
    expect((await b.worker.runOnce()).stopped).toBeNull();
    expect(await a.manager.getItem(item.id)).toMatchObject({
      title: "B 的标题",
      detail: "B 的补充",
    });
    expect(await b.manager.getItem(item.id)).toMatchObject({
      title: "B 的标题",
      detail: "B 的补充",
    });
  } finally {
    await server.close();
    await postgres.close();
  }
});
