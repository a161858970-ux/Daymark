import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import pg from "pg";
import { expect, it } from "vitest";
import type { CloudDatabase, QueryPort } from "./cloud.js";
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
