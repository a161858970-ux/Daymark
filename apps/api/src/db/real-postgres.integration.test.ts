import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import pg from "pg";
import { expect, it } from "vitest";
import type { CloudDatabase, QueryPort } from "./cloud.js";
import { CloudDaymark } from "./cloud.js";
import { CloudSync } from "./sync.js";

const databaseUrl = process.env.REAL_DATABASE_URL;
const realPostgres = databaseUrl ? it : it.skip;

realPostgres(
  "runs migrations and collection sync against an isolated real PostgreSQL schema",
  async () => {
    const client = new pg.Client({ connectionString: databaseUrl });
    const schema = `cm_verify_${randomUUID().replaceAll("-", "")}`;
    await client.connect();
    try {
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`SET search_path TO "${schema}"`);
      const directory = fileURLToPath(
        new URL("../../../../backend/migrations/", import.meta.url),
      );
      for (const name of [
        "001_initial.sql",
        "002_collection_sync.sql",
        "003_course_import.sql",
        "004_reminder_delivery.sql",
        "005_schedule_times_nullable.sql",
        "006_course_import_parse_cache.sql",
        "007_date_precision.sql",
      ])
        await client.query(await readFile(join(directory, name), "utf8"));
      const port: CloudDatabase = {
        query: async <Row extends object = Record<string, unknown>>(
          sql: string,
          params?: unknown[],
        ) => {
          const result = await client.query<Row>(sql, params);
          return { rows: result.rows };
        },
        transaction: async <T>(work: (query: QueryPort) => Promise<T>) => {
          await client.query("BEGIN");
          try {
            const value = await work({
              query: async <Row extends object = Record<string, unknown>>(
                sql: string,
                params?: unknown[],
              ) => {
                const result = await client.query<Row>(sql, params);
                return { rows: result.rows };
              },
            });
            await client.query("COMMIT");
            return value;
          } catch (error) {
            await client.query("ROLLBACK");
            throw error;
          }
        },
      };
      const sync = new CloudSync(port);
      const owner = randomUUID();
      const semesterId = randomUUID();
      const weekId = randomUUID();
      const now = new Date().toISOString();
      await sync.pushOne(owner, {
        mutation_id: randomUUID(),
        entity_type: "SEMESTER",
        entity_id: semesterId,
        operation: "CREATE",
        base_version: null,
        changed_fields: {
          name: "PostgreSQL 验证学期",
          start_date: "2026-09-01",
          end_date: "2026-12-31",
          created_at: now,
          updated_at: now,
        },
      });
      const result = await sync.pushOne(owner, {
        mutation_id: randomUUID(),
        entity_type: "SEMESTER_WEEK_COLLECTION",
        entity_id: semesterId,
        operation: "UPDATE",
        base_version: 0,
        changed_fields: {
          previous_collection: [],
          collection: [
            {
              id: weekId,
              semester_id: semesterId,
              week_number: 1,
              start_date: "2026-09-01",
              end_date: "2026-09-07",
            },
          ],
        },
      });
      expect(result).toMatchObject({ result: "ACK", entity_version: 1 });
      const saved = await client.query<{ id: string }>(
        "SELECT id FROM semester_weeks WHERE semester_id=$1",
        [semesterId],
      );
      expect(saved.rows).toEqual([{ id: weekId }]);
      const envelope = await client.query<{ count: string }>(
        "SELECT count(*) FROM change_log WHERE entity_type='SEMESTER_WEEK_COLLECTION' AND entity_id=$1",
        [semesterId],
      );
      expect(Number(envelope.rows[0]?.count)).toBe(1);
    } finally {
      await client.query("SET search_path TO public").catch(() => undefined);
      await client
        .query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
        .catch(() => undefined);
      await client.end();
    }
  },
  30_000,
);

realPostgres(
  "upgrades legacy DATETIME rows through 007 and enforces DATE/DATETIME precision end to end",
  async () => {
    const client = new pg.Client({ connectionString: databaseUrl });
    const schema = `cm_verify_${randomUUID().replaceAll("-", "")}`;
    await client.connect();
    try {
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`SET search_path TO "${schema}"`);
      const directory = fileURLToPath(
        new URL("../../../../backend/migrations/", import.meta.url),
      );
      const apply = async (name: string) =>
        client.query(await readFile(join(directory, name), "utf8"));
      // Historical shape first: 001–006 only, then legacy rows written the way
      // pre-007 clients wrote them (DATETIME instants, no *_date columns).
      for (const name of [
        "001_initial.sql",
        "002_collection_sync.sql",
        "003_course_import.sql",
        "004_reminder_delivery.sql",
        "005_schedule_times_nullable.sql",
        "006_course_import_parse_cache.sql",
      ])
        await apply(name);
      const owner = randomUUID();
      const now = new Date().toISOString();
      const legacyDueAt = "2026-10-12T07:00:00.000Z";
      const legacyCaptureId = randomUUID();
      const legacyItemId = randomUUID();
      await client.query(
        `INSERT INTO raw_captures (id, owner_id, source, raw_text, captured_at, processing_status)
         VALUES ($1,$2,'QUICK_CAPTURE','10.12截止',$3,'RAW')`,
        [legacyCaptureId, owner, now],
      );
      await client.query(
        `INSERT INTO items (id, owner_id, title, detail, status, start_at, occurrence_start_at, occurrence_end_at, due_at, reminder_level, created_at, updated_at, raw_capture_id)
         VALUES ($1,$2,'期末论文',NULL,'INCOMPLETE',NULL,NULL,NULL,$3,'NORMAL',$4,$4,$5)`,
        [legacyItemId, owner, legacyDueAt, now, legacyCaptureId],
      );
      // 007 applies forward on top of legacy data without touching it.
      await apply("007_date_precision.sql");
      const upgraded = await client.query(
        "SELECT due_at, due_date, occurrence_start_at, occurrence_start_date, time_zone FROM items WHERE id=$1",
        [legacyItemId],
      );
      expect(upgraded.rows[0]?.due_date).toBeNull();
      expect(upgraded.rows[0]?.occurrence_start_date).toBeNull();
      expect(upgraded.rows[0]?.time_zone).toBeNull();
      expect(new Date(upgraded.rows[0]!.due_at).toISOString()).toBe(
        legacyDueAt,
      );
      const upgradedCapture = await client.query(
        "SELECT captured_tz FROM raw_captures WHERE id=$1",
        [legacyCaptureId],
      );
      expect(upgradedCapture.rows[0]?.captured_tz).toBeNull();

      const port: CloudDatabase = {
        query: async <Row extends object = Record<string, unknown>>(
          sql: string,
          params?: unknown[],
        ) => {
          const result = await client.query<Row>(sql, params);
          return { rows: result.rows };
        },
        transaction: async <T>(work: (query: QueryPort) => Promise<T>) => {
          await client.query("BEGIN");
          try {
            const value = await work({
              query: async <Row extends object = Record<string, unknown>>(
                sql: string,
                params?: unknown[],
              ) => {
                const result = await client.query<Row>(sql, params);
                return { rows: result.rows };
              },
            });
            await client.query("COMMIT");
            return value;
          } catch (error) {
            await client.query("ROLLBACK");
            throw error;
          }
        },
      };
      const cloud = new CloudDaymark(port);
      const sync = new CloudSync(port);

      // API read keeps the legacy DATETIME meaning untouched.
      const viaApi = await cloud.getItem(owner, legacyItemId);
      expect(viaApi?.due_date).toBeNull();
      expect(new Date(viaApi!.due_at!).toISOString()).toBe(legacyDueAt);

      // DB-level mutual exclusion is enforced by constraints, not only Zod.
      await expect(
        client.query("UPDATE items SET due_date='2026-10-12' WHERE id=$1", [
          legacyItemId,
        ]),
      ).rejects.toThrow(/items_due_precision_check/);
      await expect(
        client.query(
          "UPDATE items SET start_at=now(), start_date='2026-10-12' WHERE id=$1",
          [legacyItemId],
        ),
      ).rejects.toThrow(/items_start_precision_check/);
      await expect(
        client.query(
          `INSERT INTO items (id, owner_id, title, status, occurrence_start_date, occurrence_end_date, reminder_level, created_at, updated_at)
           VALUES ($1,$2,'冲突区间','INCOMPLETE','2026-10-20','2026-10-12','NORMAL',$3,$3)`,
          [randomUUID(), owner, now],
        ),
      ).rejects.toThrow(/items_occurrence_date_order_check/);

      // API write: DATE precision round-trip, then explicit precision switch.
      const capture = await cloud.createRawCapture(owner, randomUUID(), {
        source: "QUICK_CAPTURE",
        raw_text: "下周三课堂展示",
        captured_at: "2026-10-09T02:00:00.000Z",
        captured_tz: "Asia/Shanghai",
      });
      const dateItemInput = {
        title: "课堂展示",
        detail: null,
        course_id: null,
        status: "INCOMPLETE" as const,
        start_at: null,
        start_date: null,
        occurrence_start_at: null,
        occurrence_start_date: "2026-10-21",
        occurrence_end_at: null,
        occurrence_end_date: null,
        due_at: null,
        due_date: "2026-10-20",
        time_zone: "Asia/Shanghai",
        reminder_level: "NORMAL" as const,
        raw_capture_id: capture.id,
      };
      const created = await cloud.createItem(
        owner,
        randomUUID(),
        dateItemInput,
      );
      expect(created.due_date).toBe("2026-10-20");
      expect(created.occurrence_start_date).toBe("2026-10-21");
      expect(created.time_zone).toBe("Asia/Shanghai");
      expect(created.due_at).toBeNull();
      const reread = await cloud.getItem(owner, created.id);
      expect(reread).toMatchObject({
        due_date: "2026-10-20",
        occurrence_start_date: "2026-10-21",
        time_zone: "Asia/Shanghai",
        due_at: null,
      });
      // API-level exclusion: both sides of one endpoint is rejected —
      // here by the database CHECK (cloud.createItem does not pre-parse Zod).
      await expect(
        cloud.createItem(owner, randomUUID(), {
          ...dateItemInput,
          due_at: "2026-10-20T07:00:00.000Z",
        }),
      ).rejects.toThrow(/items_due_precision_check|DATE or DATETIME/);
      // Explicit precision switch clears the other side of the endpoint.
      await cloud.updateItem(
        owner,
        created.id,
        randomUUID(),
        reread!.row_version,
        {
          due_date: null,
          due_at: "2026-10-20T07:00:00.000Z",
        },
      );
      const switched = await cloud.getItem(owner, created.id);
      expect(switched?.due_date).toBeNull();
      expect(new Date(switched!.due_at!).toISOString()).toBe(
        "2026-10-20T07:00:00.000Z",
      );

      // Sync round-trip: DATE fields survive push + change-stream pull.
      const syncOwner = randomUUID();
      const syncItemId = randomUUID();
      const pushed = await sync.pushOne(syncOwner, {
        mutation_id: randomUUID(),
        entity_type: "ITEM",
        entity_id: syncItemId,
        operation: "CREATE",
        base_version: null,
        changed_fields: {
          ...dateItemInput,
          raw_capture_id: null,
          created_at: now,
          updated_at: now,
        },
      });
      expect(pushed).toMatchObject({ result: "ACK", entity_version: 1 });
      const page = await sync.changes(syncOwner, undefined, 50);
      const entry = page.data.find((row) => row.entity_id === syncItemId);
      expect(entry?.changed_fields).toMatchObject({
        due_date: "2026-10-20",
        occurrence_start_date: "2026-10-21",
        time_zone: "Asia/Shanghai",
      });
      const syncRow = await client.query(
        "SELECT due_date::text AS due_date, occurrence_start_date::text AS occurrence_start_date, due_at, time_zone FROM items WHERE id=$1",
        [syncItemId],
      );
      expect(syncRow.rows[0]).toMatchObject({
        due_date: "2026-10-20",
        occurrence_start_date: "2026-10-21",
        time_zone: "Asia/Shanghai",
        due_at: null,
      });

      // Legacy pre-007 client payload: none of the new keys at all. ADR-010
      // requires "缺省视为 null" so old clients keep syncing.
      const legacySyncItemId = randomUUID();
      const legacyPushed = await sync.pushOne(syncOwner, {
        mutation_id: randomUUID(),
        entity_type: "ITEM",
        entity_id: legacySyncItemId,
        operation: "CREATE",
        base_version: null,
        changed_fields: {
          title: "旧客户端事项",
          detail: null,
          course_id: null,
          status: "INCOMPLETE",
          start_at: null,
          occurrence_start_at: null,
          occurrence_end_at: null,
          due_at: "2026-10-25T02:00:00.000Z",
          reminder_level: "NORMAL",
          raw_capture_id: null,
          created_at: now,
          updated_at: now,
        },
      });
      expect(legacyPushed).toMatchObject({ result: "ACK" });
      const legacyRow = await client.query(
        "SELECT due_at, due_date::text AS due_date, time_zone FROM items WHERE id=$1",
        [legacySyncItemId],
      );
      expect(legacyRow.rows[0]?.due_date).toBeNull();
      expect(legacyRow.rows[0]?.time_zone).toBeNull();
      expect(new Date(legacyRow.rows[0]!.due_at).toISOString()).toBe(
        "2026-10-25T02:00:00.000Z",
      );
    } finally {
      await client.query("SET search_path TO public").catch(() => undefined);
      await client
        .query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
        .catch(() => undefined);
      await client.end();
    }
  },
  60_000,
);
