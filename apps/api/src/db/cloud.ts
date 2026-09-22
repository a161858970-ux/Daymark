import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type {
  Course,
  CourseInformation,
  Item,
  RawCapture,
} from "@course-manager/domain";
import {
  calendarItems,
  hasItemTime,
  sortOverview,
  visibleOverviewItems,
} from "@course-manager/domain";
import type { Semester } from "@course-manager/domain";
import type {
  CreateItemInput,
  CreateRawCaptureInput,
} from "@course-manager/contracts";
import { updateItemSchema } from "@course-manager/contracts";

export interface QueryPort {
  query<Row extends object = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: Row[] }>;
}

export interface CloudDatabase extends QueryPort {
  transaction<T>(work: (query: QueryPort) => Promise<T>): Promise<T>;
}

export class PoolCloudDatabase implements CloudDatabase {
  constructor(private readonly pool: Pool) {}

  async query<Row extends object = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: Row[] }> {
    const result = await this.pool.query<Row>(sql, params);
    return { rows: result.rows };
  }

  async transaction<T>(work: (query: QueryPort) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
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
    } finally {
      client.release();
    }
  }
}

export class CloudError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

type MutationOutcome<T extends object> =
  { data: T; conflict_id?: never } | { data?: never; conflict_id: string };

interface IdempotencyRow {
  request_hash: string;
  response: unknown;
}

async function singleJson<T extends object>(
  query: QueryPort,
  sql: string,
  params: unknown[],
): Promise<T | null> {
  const result = await query.query<{ value: T }>(sql, params);
  return result.rows[0]?.value ?? null;
}

export class CloudCourseManager {
  constructor(private readonly db: CloudDatabase) {}

  private async allItems(ownerId: string): Promise<Item[]> {
    const result = await this.db.query<{ value: Item }>(
      "SELECT row_to_json(i) AS value FROM items i WHERE owner_id = $1 AND deleted_at IS NULL",
      [ownerId],
    );
    const iso = (value: string | null): string | null =>
      value ? new Date(value).toISOString() : null;
    return result.rows.map(({ value }) => ({
      ...value,
      created_at: iso(value.created_at)!,
      updated_at: iso(value.updated_at)!,
      completed_at: iso(value.completed_at),
      deleted_at: iso(value.deleted_at),
      start_at: iso(value.start_at),
      occurrence_start_at: iso(value.occurrence_start_at),
      occurrence_end_at: iso(value.occurrence_end_at),
      due_at: iso(value.due_at),
    }));
  }

  private async allCourses(ownerId: string): Promise<Course[]> {
    const result = await this.db.query<{ value: Course }>(
      "SELECT row_to_json(c) AS value FROM courses c WHERE owner_id = $1 AND deleted_at IS NULL",
      [ownerId],
    );
    return result.rows.map((row) => row.value);
  }

  private page<T extends { id: string }>(
    values: T[],
    afterId: string | null,
    limit: number,
  ): { data: T[]; next_cursor: string | null } {
    const index = afterId
      ? values.findIndex((value) => value.id === afterId)
      : -1;
    if (afterId && index < 0)
      throw new CloudError(
        "VALIDATION_ERROR",
        400,
        "List cursor is no longer valid",
      );
    const data = values.slice(index + 1, index + 1 + limit);
    const next_cursor =
      index + 1 + limit < values.length ? (data.at(-1)?.id ?? null) : null;
    return { data, next_cursor };
  }

  async overview(
    ownerId: string,
    today: string,
    now: string,
    semesterId: string | undefined,
    cursor: string | null,
    limit: number,
  ): Promise<{ data: Item[]; next_cursor: string | null }> {
    const [items, courses, semesterRows] = await Promise.all([
      this.allItems(ownerId),
      this.allCourses(ownerId),
      this.db.query<{ value: Semester }>(
        "SELECT row_to_json(s) AS value FROM semesters s WHERE owner_id = $1 AND deleted_at IS NULL",
        [ownerId],
      ),
    ]);
    const semesters = semesterRows.rows.map((row) => row.value);
    if (semesterId && !semesters.some((value) => value.id === semesterId))
      throw new CloudError("NOT_FOUND", 404, "Semester not found");
    return this.page(
      sortOverview(
        visibleOverviewItems(items, courses, semesters, today, semesterId),
        now,
      ),
      cursor,
      limit,
    );
  }

  async listItems(
    ownerId: string,
    filters: {
      course_id: string | undefined;
      status: Item["status"] | undefined;
      has_time: boolean | undefined;
      from: string | undefined;
      to: string | undefined;
    },
    cursor: string | null,
    limit: number,
  ): Promise<{ data: Item[]; next_cursor: string | null }> {
    const values = (await this.allItems(ownerId))
      .filter((item) =>
        filters.course_id === undefined
          ? true
          : item.course_id === filters.course_id,
      )
      .filter((item) =>
        filters.status === undefined ? true : item.status === filters.status,
      )
      .filter((item) =>
        filters.has_time === undefined
          ? true
          : hasItemTime(item) === filters.has_time,
      )
      .filter((item) => {
        if (!filters.from && !filters.to) return true;
        return (
          calendarItems(
            [item],
            filters.from ?? "0000-01-01T00:00:00Z",
            filters.to ?? "9999-12-31T23:59:59Z",
          ).length > 0
        );
      })
      .sort(
        (a, b) =>
          b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id),
      );
    return this.page(values, cursor, limit);
  }

  async listCourses(
    ownerId: string,
    semesterId: string | null,
    cursor: string | null,
    limit: number,
  ): Promise<{ data: Course[]; next_cursor: string | null }> {
    const values = (await this.allCourses(ownerId))
      .filter((course) => course.semester_id === semesterId)
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    return this.page(values, cursor, limit);
  }

  async getCourse(ownerId: string, id: string): Promise<Course | null> {
    return singleJson<Course>(
      this.db,
      "SELECT row_to_json(c) AS value FROM courses c WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL",
      [id, ownerId],
    );
  }

  async deleteCourseWithStrategy(
    ownerId: string,
    courseId: string,
    key: string,
    baseVersion: number,
    strategy: "DELETE_ASSOCIATED_ITEMS" | "UNLINK_ASSOCIATED_ITEMS",
    itemVersions?: { id: string; row_version: number }[],
    deletedAt?: string,
  ): Promise<{ course: Course; items: Item[] }> {
    return this.idempotent(
      ownerId,
      key,
      `course:delete:${courseId}:${baseVersion}`,
      {
        strategy,
        itemVersions,
        deletedAt,
      },
      async (q) => {
        const course = await singleJson<Course>(
          q,
          "SELECT row_to_json(c) AS value FROM courses c WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL FOR UPDATE",
          [courseId, ownerId],
        );
        if (!course) throw new CloudError("NOT_FOUND", 404, "Course not found");
        if (Number(course.row_version) !== baseVersion)
          throw new CloudError(
            "VERSION_CONFLICT",
            409,
            "Course changed on another device",
          );
        const attached = await q.query<{ value: Item }>(
          "SELECT row_to_json(i) AS value FROM items i WHERE owner_id=$1 AND course_id=$2 AND deleted_at IS NULL ORDER BY id FOR UPDATE",
          [ownerId, courseId],
        );
        const current = attached.rows.map((row) => row.value);
        if (itemVersions) {
          const expected = [...itemVersions].sort((a, b) =>
            a.id.localeCompare(b.id),
          );
          if (
            expected.length !== current.length ||
            expected.some(
              (entry, index) =>
                entry.id !== current[index]?.id ||
                entry.row_version !== Number(current[index]?.row_version),
            )
          )
            throw new CloudError(
              "VERSION_CONFLICT",
              409,
              "Course items changed on another device",
            );
        }
        const when = deletedAt ?? new Date().toISOString();
        const items: Item[] = [];
        for (const item of current) {
          const changed =
            strategy === "DELETE_ASSOCIATED_ITEMS"
              ? await singleJson<Item>(
                  q,
                  `WITH changed AS (UPDATE items SET deleted_at=$3,updated_at=$3,row_version=row_version+1
               WHERE id=$1 AND owner_id=$2 RETURNING *) SELECT row_to_json(changed) AS value FROM changed`,
                  [item.id, ownerId, when],
                )
              : await singleJson<Item>(
                  q,
                  `WITH changed AS (UPDATE items SET course_id=NULL,updated_at=$3,row_version=row_version+1
               WHERE id=$1 AND owner_id=$2 RETURNING *) SELECT row_to_json(changed) AS value FROM changed`,
                  [item.id, ownerId, when],
                );
          if (!changed)
            throw new CloudError(
              "SERVER_ERROR",
              500,
              "Course item update failed",
            );
          items.push(changed);
          await q.query(
            "INSERT INTO change_log (owner_id,entity_type,entity_id,operation,changed_fields,entity_version) VALUES ($1,'ITEM',$2,$3,$4::jsonb,$5)",
            [
              ownerId,
              item.id,
              strategy === "DELETE_ASSOCIATED_ITEMS" ? "DELETE" : "UPDATE",
              JSON.stringify(changed),
              changed.row_version,
            ],
          );
        }
        const deleted = await singleJson<Course>(
          q,
          `WITH changed AS (UPDATE courses SET deleted_at=$3,updated_at=$3,row_version=row_version+1
         WHERE id=$1 AND owner_id=$2 RETURNING *) SELECT row_to_json(changed) AS value FROM changed`,
          [courseId, ownerId, when],
        );
        if (!deleted)
          throw new CloudError("SERVER_ERROR", 500, "Course deletion failed");
        await q.query(
          "INSERT INTO change_log (owner_id,entity_type,entity_id,operation,changed_fields,entity_version) VALUES ($1,'COURSE',$2,'DELETE',$3::jsonb,$4)",
          [ownerId, courseId, JSON.stringify(deleted), deleted.row_version],
        );
        return { course: deleted, items };
      },
    );
  }

  async listCourseInformation(
    ownerId: string,
    courseId: string,
    cursor: string | null,
    limit: number,
  ): Promise<{ data: CourseInformation[]; next_cursor: string | null }> {
    if (!(await this.getCourse(ownerId, courseId)))
      throw new CloudError("NOT_FOUND", 404, "Course not found");
    const result = await this.db.query<{ value: CourseInformation }>(
      "SELECT row_to_json(c) AS value FROM course_information c WHERE owner_id = $1 AND course_id = $2 AND deleted_at IS NULL",
      [ownerId, courseId],
    );
    const values = result.rows
      .map((row) => row.value)
      .sort(
        (a, b) =>
          b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id),
      );
    return this.page(values, cursor, limit);
  }

  async listUnresolvedCaptures(
    ownerId: string,
    cursor: string | null,
    limit: number,
  ): Promise<{ data: RawCapture[]; next_cursor: string | null }> {
    const result = await this.db.query<{ value: RawCapture }>(
      "SELECT row_to_json(r) AS value FROM raw_captures r WHERE owner_id = $1 AND deleted_at IS NULL AND processing_status = 'UNRESOLVED'",
      [ownerId],
    );
    const values = result.rows
      .map((row) => row.value)
      .sort(
        (a, b) =>
          b.captured_at.localeCompare(a.captured_at) ||
          b.id.localeCompare(a.id),
      );
    return this.page(values, cursor, limit);
  }

  private async idempotent<T extends object>(
    ownerId: string,
    key: string,
    operation: string,
    body: unknown,
    work: (query: QueryPort) => Promise<T>,
  ): Promise<T> {
    const hash = createHash("sha256")
      .update(JSON.stringify({ operation, body }))
      .digest("hex");
    const lookup = async (query: QueryPort): Promise<T | null> => {
      const prior = await query.query<IdempotencyRow>(
        "SELECT request_hash, response FROM idempotency_keys WHERE owner_id = $1 AND mutation_id = $2",
        [ownerId, key],
      );
      if (!prior.rows[0]) return null;
      if (prior.rows[0].request_hash !== hash)
        throw new CloudError(
          "IDEMPOTENCY_REPLAY",
          409,
          "Idempotency key was used for a different request",
        );
      return prior.rows[0].response as T;
    };
    try {
      return await this.db.transaction(async (query) => {
        const previous = await lookup(query);
        if (previous) return previous;
        const result = await work(query);
        await query.query(
          "INSERT INTO idempotency_keys (owner_id, mutation_id, request_hash, response) VALUES ($1, $2, $3, $4::jsonb)",
          [ownerId, key, hash, JSON.stringify(result)],
        );
        return result;
      });
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "23505"
      ) {
        const previous = await lookup(this.db);
        if (previous) return previous;
      }
      throw error;
    }
  }

  async createRawCapture(
    ownerId: string,
    key: string,
    input: CreateRawCaptureInput,
  ): Promise<RawCapture> {
    return this.idempotent(
      ownerId,
      key,
      "raw-capture:create",
      input,
      async (q) => {
        const id = randomUUID();
        const capture = await singleJson<RawCapture>(
          q,
          `WITH inserted AS (
           INSERT INTO raw_captures
             (id, owner_id, source, raw_text, captured_at, processing_status,
              unresolved_reason, deleted_at, row_version)
           VALUES ($1, $2, $3, $4, $5, 'RAW', NULL, NULL, 1)
           RETURNING *
         ) SELECT row_to_json(inserted) AS value FROM inserted`,
          [id, ownerId, input.source, input.raw_text, input.captured_at],
        );
        if (!capture)
          throw new CloudError("SERVER_ERROR", 500, "Capture insert failed");
        await q.query(
          "INSERT INTO change_log (owner_id, entity_type, entity_id, operation, changed_fields, entity_version) VALUES ($1, 'RAW_CAPTURE', $2, 'CREATE', $3::jsonb, 1)",
          [ownerId, id, JSON.stringify(capture)],
        );
        return capture;
      },
    );
  }

  async getRawCapture(ownerId: string, id: string): Promise<RawCapture | null> {
    return singleJson<RawCapture>(
      this.db,
      "SELECT row_to_json(r) AS value FROM raw_captures r WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL",
      [id, ownerId],
    );
  }

  async createCourse(
    ownerId: string,
    key: string,
    input: {
      name: string;
      semester_id: string | null;
      instructor: string | null;
    },
  ): Promise<Course> {
    return this.idempotent(ownerId, key, "course:create", input, async (q) => {
      if (input.semester_id) {
        const semester = await q.query<{ id: string }>(
          "SELECT id FROM semesters WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL",
          [input.semester_id, ownerId],
        );
        if (!semester.rows[0])
          throw new CloudError("NOT_FOUND", 404, "Semester not found");
      }
      const id = randomUUID();
      const course = await singleJson<Course>(
        q,
        `WITH inserted AS (
           INSERT INTO courses
             (id, owner_id, semester_id, name, instructor, created_at, updated_at, deleted_at, row_version)
           VALUES ($1, $2, $3, $4, $5, now(), now(), NULL, 1)
           RETURNING *
         ) SELECT row_to_json(inserted) AS value FROM inserted`,
        [id, ownerId, input.semester_id, input.name, input.instructor],
      );
      if (!course)
        throw new CloudError("SERVER_ERROR", 500, "Course insert failed");
      await q.query(
        "INSERT INTO change_log (owner_id, entity_type, entity_id, operation, changed_fields, entity_version) VALUES ($1, 'COURSE', $2, 'CREATE', $3::jsonb, 1)",
        [ownerId, id, JSON.stringify(course)],
      );
      return course;
    });
  }

  async createItem(
    ownerId: string,
    key: string,
    input: CreateItemInput,
  ): Promise<Item> {
    return this.idempotent(ownerId, key, "item:create", input, async (q) => {
      if (input.course_id) {
        const course = await q.query<{ id: string }>(
          "SELECT id FROM courses WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL",
          [input.course_id, ownerId],
        );
        if (!course.rows[0])
          throw new CloudError("NOT_FOUND", 404, "Course not found");
      }
      if (input.raw_capture_id) {
        const raw = await q.query<{ id: string }>(
          "SELECT id FROM raw_captures WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL",
          [input.raw_capture_id, ownerId],
        );
        if (!raw.rows[0])
          throw new CloudError("NOT_FOUND", 404, "Raw capture not found");
      }
      const id = randomUUID();
      const item = await singleJson<Item>(
        q,
        `WITH inserted AS (
           INSERT INTO items
             (id, owner_id, course_id, title, detail, status, start_at,
              occurrence_start_at, occurrence_end_at, due_at, reminder_level,
              created_at, updated_at, completed_at, deleted_at, row_version, raw_capture_id)
           VALUES ($1, $2, $3, $4, $5, 'INCOMPLETE', $6, $7, $8, $9, $10,
                   now(), now(), NULL, NULL, 1, $11)
           RETURNING *
         ) SELECT row_to_json(inserted) AS value FROM inserted`,
        [
          id,
          ownerId,
          input.course_id,
          input.title,
          input.detail,
          input.start_at,
          input.occurrence_start_at,
          input.occurrence_end_at,
          input.due_at,
          input.reminder_level,
          input.raw_capture_id,
        ],
      );
      if (!item)
        throw new CloudError("SERVER_ERROR", 500, "Item insert failed");
      await q.query(
        "INSERT INTO change_log (owner_id, entity_type, entity_id, operation, changed_fields, entity_version) VALUES ($1, 'ITEM', $2, 'CREATE', $3::jsonb, 1)",
        [ownerId, id, JSON.stringify(item)],
      );
      if (input.raw_capture_id) {
        const outputId = randomUUID();
        const output = await singleJson<{
          id: string;
          owner_id: string;
          raw_capture_id: string;
          object_type: "ITEM";
          object_id: string;
          created_at: string;
        }>(
          q,
          `WITH inserted AS (
             INSERT INTO raw_capture_outputs
               (id, owner_id, raw_capture_id, object_type, object_id, created_at)
             VALUES ($1, $2, $3, 'ITEM', $4, now()) RETURNING *
           ) SELECT row_to_json(inserted) AS value FROM inserted`,
          [outputId, ownerId, input.raw_capture_id, id],
        );
        if (!output)
          throw new CloudError(
            "SERVER_ERROR",
            500,
            "Capture output insert failed",
          );
        const rawUpdate = await q.query<{ row_version: number }>(
          "UPDATE raw_captures SET processing_status = 'RESOLVED', unresolved_reason = NULL, row_version = row_version + 1 WHERE id = $1 AND owner_id = $2 RETURNING row_version",
          [input.raw_capture_id, ownerId],
        );
        await q.query(
          "INSERT INTO change_log (owner_id, entity_type, entity_id, operation, changed_fields, entity_version) VALUES ($1, 'RAW_CAPTURE_OUTPUT', $2, 'CREATE', $3::jsonb, 1)",
          [ownerId, outputId, JSON.stringify(output)],
        );
        await q.query(
          "INSERT INTO change_log (owner_id, entity_type, entity_id, operation, changed_fields, entity_version) VALUES ($1, 'RAW_CAPTURE', $2, 'UPDATE', $3::jsonb, $4)",
          [
            ownerId,
            input.raw_capture_id,
            JSON.stringify({
              processing_status: "RESOLVED",
              unresolved_reason: null,
            }),
            rawUpdate.rows[0]!.row_version,
          ],
        );
      }
      return item;
    });
  }

  async getItem(ownerId: string, id: string): Promise<Item | null> {
    return singleJson<Item>(
      this.db,
      "SELECT row_to_json(i) AS value FROM items i WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL",
      [id, ownerId],
    );
  }

  private async conflict(
    query: QueryPort,
    ownerId: string,
    item: Item,
    baseVersion: number,
    field: string | string[],
    requested: Record<string, unknown>,
  ): Promise<string> {
    const id = randomUUID();
    await query.query(
      `INSERT INTO sync_conflicts
        (id, owner_id, entity_type, entity_id, local_version, remote_version,
         conflicting_fields, status, created_at)
       VALUES ($1, $2, 'ITEM', $3, $4::jsonb, $5::jsonb, $6::jsonb, 'OPEN', now())`,
      [
        id,
        ownerId,
        item.id,
        JSON.stringify({ base_version: baseVersion, ...requested }),
        JSON.stringify(item),
        JSON.stringify(Array.isArray(field) ? field : [field]),
      ],
    );
    return id;
  }

  private unwrap<T extends object>(outcome: MutationOutcome<T>): T {
    if (outcome.conflict_id)
      throw new CloudError(
        "VERSION_CONFLICT",
        409,
        "Item was changed elsewhere",
        {
          conflict_id: outcome.conflict_id,
        },
      );
    return outcome.data!;
  }

  async updateItem(
    ownerId: string,
    id: string,
    key: string,
    baseVersion: number,
    requested: unknown,
  ): Promise<Item> {
    const changes = updateItemSchema.parse(requested);
    const fields = Object.keys(changes) as (keyof typeof changes)[];
    if (fields.length === 0)
      throw new CloudError(
        "VALIDATION_ERROR",
        400,
        "No Item fields were changed",
      );
    const outcome = await this.idempotent<MutationOutcome<Item>>(
      ownerId,
      key,
      "item:update",
      { id, baseVersion, changes },
      async (q) => {
        const item = await singleJson<Item>(
          q,
          "SELECT row_to_json(i) AS value FROM items i WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL FOR UPDATE",
          [id, ownerId],
        );
        if (!item) throw new CloudError("NOT_FOUND", 404, "Item not found");
        if (baseVersion > item.row_version)
          throw new CloudError(
            "VALIDATION_ERROR",
            400,
            "Future Item version is invalid",
          );
        if (changes.course_id) {
          const course = await q.query<{ id: string }>(
            "SELECT id FROM courses WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL",
            [changes.course_id, ownerId],
          );
          if (!course.rows[0])
            throw new CloudError("NOT_FOUND", 404, "Course not found");
        }
        if (baseVersion < item.row_version) {
          const history = await q.query<{
            changed_fields: Record<string, unknown>;
          }>(
            `SELECT changed_fields FROM change_log
             WHERE owner_id = $1 AND entity_type = 'ITEM' AND entity_id = $2
               AND entity_version > $3 AND entity_version <= $4
             ORDER BY entity_version`,
            [ownerId, id, baseVersion, item.row_version],
          );
          const concurrentKeys = new Set(
            history.rows.flatMap((entry) =>
              Object.keys(entry.changed_fields ?? {}),
            ),
          );
          const overlap = fields.filter(
            (field) =>
              concurrentKeys.has(field) &&
              item[field as keyof Item] !== changes[field],
          );
          if (overlap.length)
            return {
              conflict_id: await this.conflict(
                q,
                ownerId,
                item,
                baseVersion,
                overlap,
                changes,
              ),
            };
        }
        const next = { ...item, ...changes };
        if (
          next.occurrence_start_at &&
          next.occurrence_end_at &&
          next.occurrence_start_at > next.occurrence_end_at
        )
          throw new CloudError(
            "VALIDATION_ERROR",
            400,
            "Occurrence end precedes start",
          );
        const updates = fields.map(
          (field, index) => `${field} = $${index + 3}`,
        );
        const updated = await singleJson<Item>(
          q,
          `WITH changed AS (
             UPDATE items SET ${updates.join(", ")}, updated_at = now(),
               row_version = row_version + 1
             WHERE id = $1 AND owner_id = $2 RETURNING *
           ) SELECT row_to_json(changed) AS value FROM changed`,
          [id, ownerId, ...fields.map((field) => changes[field])],
        );
        if (!updated)
          throw new CloudError("SERVER_ERROR", 500, "Item update failed");
        await q.query(
          "INSERT INTO change_log (owner_id, entity_type, entity_id, operation, changed_fields, entity_version) VALUES ($1, 'ITEM', $2, 'UPDATE', $3::jsonb, $4)",
          [ownerId, id, JSON.stringify(changes), updated.row_version],
        );
        return { data: updated };
      },
    );
    return this.unwrap(outcome);
  }

  async setItemComplete(
    ownerId: string,
    id: string,
    key: string,
    baseVersion: number,
    complete: boolean,
  ): Promise<Item> {
    const desired = complete ? "COMPLETE" : "INCOMPLETE";
    const outcome = await this.idempotent<MutationOutcome<Item>>(
      ownerId,
      key,
      complete ? "item:complete" : "item:restore",
      { id, baseVersion },
      async (q) => {
        const item = await singleJson<Item>(
          q,
          "SELECT row_to_json(i) AS value FROM items i WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL FOR UPDATE",
          [id, ownerId],
        );
        if (!item) throw new CloudError("NOT_FOUND", 404, "Item not found");
        if (item.status === desired) return { data: item };
        if (item.row_version !== baseVersion)
          return {
            conflict_id: await this.conflict(
              q,
              ownerId,
              item,
              baseVersion,
              "status",
              {
                status: desired,
              },
            ),
          };
        const updated = await singleJson<Item>(
          q,
          `WITH changed AS (
             UPDATE items SET status = $3,
               completed_at = CASE WHEN $3 = 'COMPLETE' THEN now() ELSE NULL END,
               updated_at = now(), row_version = row_version + 1
             WHERE id = $1 AND owner_id = $2 RETURNING *
           ) SELECT row_to_json(changed) AS value FROM changed`,
          [id, ownerId, desired],
        );
        if (!updated)
          throw new CloudError("SERVER_ERROR", 500, "Item update failed");
        await q.query(
          "INSERT INTO change_log (owner_id, entity_type, entity_id, operation, changed_fields, entity_version) VALUES ($1, 'ITEM', $2, 'UPDATE', $3::jsonb, $4)",
          [
            ownerId,
            id,
            JSON.stringify({
              status: desired,
              completed_at: updated.completed_at,
            }),
            updated.row_version,
          ],
        );
        return { data: updated };
      },
    );
    return this.unwrap(outcome);
  }

  async deleteItem(
    ownerId: string,
    id: string,
    key: string,
    baseVersion: number,
    providedToken?: string,
  ): Promise<{ item: Item; undo_token: string; undo_expires_at: string }> {
    const outcome = await this.idempotent<
      MutationOutcome<{
        item: Item;
        undo_token: string;
        undo_expires_at: string;
      }>
    >(
      ownerId,
      key,
      "item:delete",
      { id, baseVersion, providedToken },
      async (q) => {
        const item = await singleJson<Item>(
          q,
          "SELECT row_to_json(i) AS value FROM items i WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL FOR UPDATE",
          [id, ownerId],
        );
        if (!item) throw new CloudError("NOT_FOUND", 404, "Item not found");
        if (item.row_version !== baseVersion)
          return {
            conflict_id: await this.conflict(
              q,
              ownerId,
              item,
              baseVersion,
              "deleted_at",
              {
                deleted_at: "DELETE",
                undo_token: providedToken,
              },
            ),
          };
        const token = providedToken ?? randomBytes(32).toString("base64url");
        const tokenHash = createHash("sha256").update(token).digest("hex");
        const expiresAt = new Date(Date.now() + 10_000).toISOString();
        const updated = await singleJson<Item>(
          q,
          `WITH changed AS (
           UPDATE items SET deleted_at = now(), updated_at = now(),
             row_version = row_version + 1
           WHERE id = $1 AND owner_id = $2 RETURNING *
         ) SELECT row_to_json(changed) AS value FROM changed`,
          [id, ownerId],
        );
        if (!updated)
          throw new CloudError("SERVER_ERROR", 500, "Item delete failed");
        await q.query(
          `INSERT INTO delete_undo_tokens (owner_id, item_id, token_hash, expires_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (owner_id, item_id)
         DO UPDATE SET token_hash = EXCLUDED.token_hash, expires_at = EXCLUDED.expires_at, consumed_at = NULL`,
          [ownerId, id, tokenHash, expiresAt],
        );
        await q.query(
          "INSERT INTO change_log (owner_id, entity_type, entity_id, operation, changed_fields, entity_version) VALUES ($1, 'ITEM', $2, 'DELETE', $3::jsonb, $4)",
          [
            ownerId,
            id,
            JSON.stringify({ deleted_at: updated.deleted_at }),
            updated.row_version,
          ],
        );
        return {
          data: {
            item: updated,
            undo_token: token,
            undo_expires_at: expiresAt,
          },
        };
      },
    );
    return this.unwrap(outcome);
  }

  async undoDelete(
    ownerId: string,
    id: string,
    key: string,
    token: string,
  ): Promise<Item> {
    return this.idempotent(
      ownerId,
      key,
      "item:undo-delete",
      { id, token },
      async (q) => {
        const item = await singleJson<Item>(
          q,
          "SELECT row_to_json(i) AS value FROM items i WHERE id = $1 AND owner_id = $2 FOR UPDATE",
          [id, ownerId],
        );
        if (!item?.deleted_at)
          throw new CloudError("NOT_FOUND", 404, "Deleted Item not found");
        const stored = await q.query<{
          token_hash: string;
          expires_at: string;
          consumed_at: string | null;
        }>(
          "SELECT token_hash, expires_at, consumed_at FROM delete_undo_tokens WHERE owner_id = $1 AND item_id = $2 FOR UPDATE",
          [ownerId, id],
        );
        const record = stored.rows[0];
        const hash = createHash("sha256").update(token).digest("hex");
        if (
          !record ||
          record.token_hash !== hash ||
          record.consumed_at ||
          new Date(record.expires_at).getTime() < Date.now()
        )
          throw new CloudError("FORBIDDEN", 403, "Delete Undo has expired");
        const restored = await singleJson<Item>(
          q,
          `WITH changed AS (
           UPDATE items SET deleted_at = NULL, updated_at = now(),
             row_version = row_version + 1
           WHERE id = $1 AND owner_id = $2 RETURNING *
         ) SELECT row_to_json(changed) AS value FROM changed`,
          [id, ownerId],
        );
        if (!restored)
          throw new CloudError("SERVER_ERROR", 500, "Item restore failed");
        await q.query(
          "UPDATE delete_undo_tokens SET consumed_at = now() WHERE owner_id = $1 AND item_id = $2",
          [ownerId, id],
        );
        await q.query(
          "INSERT INTO change_log (owner_id, entity_type, entity_id, operation, changed_fields, entity_version) VALUES ($1, 'ITEM', $2, 'UPDATE', $3::jsonb, $4)",
          [
            ownerId,
            id,
            JSON.stringify({ deleted_at: null }),
            restored.row_version,
          ],
        );
        return restored;
      },
    );
  }
}
