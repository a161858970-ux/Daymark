import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  createCourseSchema,
  createItemSchema,
  createRawCaptureSchema,
  dateOnlySchema,
  isoDateTimeSchema,
  uuidSchema,
} from "@daymark/contracts";
import {
  CloudDaymark,
  CloudError,
  type CloudDatabase,
  type QueryPort,
} from "./cloud.js";
import { CloudCollectionSync, isCollectionSyncType } from "./collections.js";

export const syncMutationSchema = z.object({
  mutation_id: uuidSchema,
  entity_type: z.enum([
    "SEMESTER",
    "SEMESTER_WEEK",
    "SEMESTER_WEEK_COLLECTION",
    "COURSE",
    "COURSE_SCHEDULE",
    "COURSE_SCHEDULE_COLLECTION",
    "COURSE_INFORMATION",
    "ITEM",
    "ITEM_ASSOCIATION",
    "RAW_CAPTURE",
    "RAW_CAPTURE_OUTPUT",
    "RAW_CAPTURE_DECISION",
  ]),
  entity_id: uuidSchema,
  operation: z.enum(["CREATE", "UPDATE", "DELETE"]),
  base_version: z.number().int().nonnegative().nullable(),
  changed_fields: z.record(z.string(), z.unknown()),
});
export type SyncMutationInput = z.infer<typeof syncMutationSchema>;

const courseInformationSchema = z.object({
  course_id: uuidSchema,
  content: z.string().trim().min(1),
});
const outputSchema = z.object({
  raw_capture_id: uuidSchema,
  object_type: z.enum(["ITEM", "COURSE_INFORMATION"]),
  object_id: uuidSchema,
  created_at: isoDateTimeSchema,
});
const decisionSchema = z.object({
  raw_capture_id: uuidSchema,
  decision_type: z.enum([
    "ITEM",
    "COURSE_INFORMATION",
    "SPLIT",
    "KEEP_ONE",
    "DEFER",
  ]),
  decision_payload: z.record(z.string(), z.unknown()).nullable(),
  decided_at: isoDateTimeSchema,
  device_id: uuidSchema,
});
const associationSchema = z.object({
  item_id_a: uuidSchema,
  item_id_b: uuidSchema,
  created_at: isoDateTimeSchema,
});

type PushResult =
  | {
      mutation_id: string;
      result: "ACK";
      entity_version: number;
      undo_expires_at?: string;
    }
  | { mutation_id: string; result: "CONFLICT"; conflict_id: string };

interface IdempotencyRow {
  request_hash: string;
  response: PushResult;
}

async function insertLog(
  q: QueryPort,
  ownerId: string,
  mutation: SyncMutationInput,
  fields: object,
  version: number,
) {
  await q.query(
    "INSERT INTO change_log (owner_id, entity_type, entity_id, operation, changed_fields, entity_version) VALUES ($1, $2, $3, $4, $5::jsonb, $6)",
    [
      ownerId,
      mutation.entity_type,
      mutation.entity_id,
      mutation.operation,
      JSON.stringify(fields),
      version,
    ],
  );
}

/** Sync creates retain client UUIDs. Authentication, not changed_fields.owner_id, defines ownership. */
export class CloudSync {
  private readonly items: CloudDaymark;
  private readonly collections: CloudCollectionSync;
  constructor(private readonly db: CloudDatabase) {
    this.items = new CloudDaymark(db);
    this.collections = new CloudCollectionSync(db);
  }

  private async owned(
    q: QueryPort,
    table:
      "semesters" | "courses" | "raw_captures" | "items" | "course_information",
    id: string,
    ownerId: string,
  ) {
    const result = await q.query<{ id: string }>(
      `SELECT id FROM ${table} WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL`,
      [id, ownerId],
    );
    if (!result.rows[0])
      throw new CloudError("NOT_FOUND", 404, `${table} reference not found`);
  }

  private async create(
    ownerId: string,
    mutation: SyncMutationInput,
  ): Promise<PushResult> {
    const hash = createHash("sha256")
      .update(JSON.stringify(mutation))
      .digest("hex");
    const lookup = async (q: QueryPort): Promise<PushResult | null> => {
      const previous = await q.query<IdempotencyRow>(
        "SELECT request_hash, response FROM idempotency_keys WHERE owner_id = $1 AND mutation_id = $2",
        [ownerId, mutation.mutation_id],
      );
      if (!previous.rows[0]) return null;
      if (previous.rows[0].request_hash !== hash)
        throw new CloudError(
          "IDEMPOTENCY_REPLAY",
          409,
          "Mutation ID was used for different data",
        );
      return previous.rows[0].response;
    };
    try {
      return await this.db.transaction(async (q) => {
        const prior = await lookup(q);
        if (prior) return prior;
        const id = mutation.entity_id;
        const input = mutation.changed_fields;
        let row: Record<string, unknown> | undefined;
        switch (mutation.entity_type) {
          case "SEMESTER": {
            const value = z
              .object({
                name: z.string().trim().min(1),
                start_date: dateOnlySchema,
                end_date: dateOnlySchema,
                created_at: isoDateTimeSchema,
                updated_at: isoDateTimeSchema,
              })
              .parse(input);
            if (value.start_date > value.end_date)
              throw new CloudError(
                "VALIDATION_ERROR",
                400,
                "Invalid semester dates",
              );
            const result = await q.query<{ value: Record<string, unknown> }>(
              `WITH inserted AS (INSERT INTO semesters
               (id,owner_id,name,start_date,end_date,created_at,updated_at,deleted_at,row_version)
               VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,1) RETURNING *)
               SELECT row_to_json(inserted) AS value FROM inserted`,
              [
                id,
                ownerId,
                value.name,
                value.start_date,
                value.end_date,
                value.created_at,
                value.updated_at,
              ],
            );
            row = result.rows[0]?.value;
            break;
          }
          case "SEMESTER_WEEK": {
            const value = z
              .object({
                semester_id: uuidSchema,
                week_number: z.number().int().positive(),
                start_date: dateOnlySchema,
                end_date: dateOnlySchema,
              })
              .parse(input);
            await this.owned(q, "semesters", value.semester_id, ownerId);
            const result = await q.query<{ value: Record<string, unknown> }>(
              `WITH inserted AS (INSERT INTO semester_weeks
               (id,owner_id,semester_id,week_number,start_date,end_date)
               VALUES ($1,$2,$3,$4,$5,$6) RETURNING *)
               SELECT row_to_json(inserted) AS value FROM inserted`,
              [
                id,
                ownerId,
                value.semester_id,
                value.week_number,
                value.start_date,
                value.end_date,
              ],
            );
            row = result.rows[0]?.value;
            break;
          }
          case "RAW_CAPTURE": {
            const value = createRawCaptureSchema.parse(input);
            const result = await q.query<{ value: Record<string, unknown> }>(
              `WITH inserted AS (INSERT INTO raw_captures
               (id, owner_id, source, raw_text, captured_at, processing_status, unresolved_reason, deleted_at, row_version)
               VALUES ($1,$2,$3,$4,$5,'RAW',NULL,NULL,1) RETURNING *)
               SELECT row_to_json(inserted) AS value FROM inserted`,
              [id, ownerId, value.source, value.raw_text, value.captured_at],
            );
            row = result.rows[0]?.value;
            break;
          }
          case "COURSE": {
            const value = createCourseSchema.parse(input);
            const createdAt = isoDateTimeSchema.parse(input.created_at);
            const updatedAt = isoDateTimeSchema.parse(input.updated_at);
            if (value.semester_id)
              await this.owned(q, "semesters", value.semester_id, ownerId);
            const result = await q.query<{ value: Record<string, unknown> }>(
              `WITH inserted AS (INSERT INTO courses
               (id,owner_id,semester_id,name,instructor,created_at,updated_at,deleted_at,row_version)
               VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,1) RETURNING *)
               SELECT row_to_json(inserted) AS value FROM inserted`,
              [
                id,
                ownerId,
                value.semester_id,
                value.name,
                value.instructor,
                createdAt,
                updatedAt,
              ],
            );
            row = result.rows[0]?.value;
            break;
          }
          case "COURSE_SCHEDULE": {
            const value = z
              .object({
                course_id: uuidSchema,
                weekday: z.number().int().min(1).max(7),
                start_time: z
                  .string()
                  .regex(/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/)
                  .nullable(),
                end_time: z
                  .string()
                  .regex(/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/)
                  .nullable(),
                week_start: z.number().int().positive().nullable(),
                week_end: z.number().int().positive().nullable(),
                classroom: z.string().nullable(),
                stage_label: z.string().nullable(),
                created_at: isoDateTimeSchema,
                updated_at: isoDateTimeSchema,
              })
              .parse(input);
            const timesValid =
              value.start_time === null && value.end_time === null
                ? true
                : value.start_time !== null &&
                  value.end_time !== null &&
                  value.start_time < value.end_time;
            if (
              !timesValid ||
              (value.week_start !== null &&
                value.week_end !== null &&
                value.week_start > value.week_end)
            )
              throw new CloudError(
                "VALIDATION_ERROR",
                400,
                "Invalid course schedule",
              );
            await this.owned(q, "courses", value.course_id, ownerId);
            const result = await q.query<{ value: Record<string, unknown> }>(
              `WITH inserted AS (INSERT INTO course_schedules
               (id,owner_id,course_id,weekday,start_time,end_time,week_start,week_end,classroom,stage_label,created_at,updated_at,deleted_at,row_version)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NULL,1) RETURNING *)
               SELECT row_to_json(inserted) AS value FROM inserted`,
              [
                id,
                ownerId,
                value.course_id,
                value.weekday,
                value.start_time,
                value.end_time,
                value.week_start,
                value.week_end,
                value.classroom,
                value.stage_label,
                value.created_at,
                value.updated_at,
              ],
            );
            row = result.rows[0]?.value;
            break;
          }
          case "ITEM": {
            const value = createItemSchema.parse(input);
            const createdAt = isoDateTimeSchema.parse(input.created_at);
            const updatedAt = isoDateTimeSchema.parse(input.updated_at);
            if (value.status !== "INCOMPLETE")
              throw new CloudError(
                "VALIDATION_ERROR",
                400,
                "New Item must be incomplete",
              );
            if (value.course_id)
              await this.owned(q, "courses", value.course_id, ownerId);
            if (value.raw_capture_id)
              await this.owned(
                q,
                "raw_captures",
                value.raw_capture_id,
                ownerId,
              );
            const result = await q.query<{ value: Record<string, unknown> }>(
              `WITH inserted AS (INSERT INTO items
               (id,owner_id,course_id,title,detail,status,start_at,occurrence_start_at,
                occurrence_end_at,due_at,reminder_level,created_at,updated_at,completed_at,
                deleted_at,row_version,raw_capture_id)
               VALUES ($1,$2,$3,$4,$5,'INCOMPLETE',$6,$7,$8,$9,$10,$12,$13,NULL,NULL,1,$11)
               RETURNING *) SELECT row_to_json(inserted) AS value FROM inserted`,
              [
                id,
                ownerId,
                value.course_id,
                value.title,
                value.detail,
                value.start_at,
                value.occurrence_start_at,
                value.occurrence_end_at,
                value.due_at,
                value.reminder_level,
                value.raw_capture_id,
                createdAt,
                updatedAt,
              ],
            );
            row = result.rows[0]?.value;
            break;
          }
          case "COURSE_INFORMATION": {
            const value = courseInformationSchema.parse(input);
            const createdAt = isoDateTimeSchema.parse(input.created_at);
            const updatedAt = isoDateTimeSchema.parse(input.updated_at);
            await this.owned(q, "courses", value.course_id, ownerId);
            const result = await q.query<{ value: Record<string, unknown> }>(
              `WITH inserted AS (INSERT INTO course_information
               (id,owner_id,course_id,content,created_at,updated_at,deleted_at,row_version)
               VALUES ($1,$2,$3,$4,$5,$6,NULL,1) RETURNING *)
               SELECT row_to_json(inserted) AS value FROM inserted`,
              [
                id,
                ownerId,
                value.course_id,
                value.content,
                createdAt,
                updatedAt,
              ],
            );
            row = result.rows[0]?.value;
            break;
          }
          case "ITEM_ASSOCIATION": {
            const value = associationSchema.parse(input);
            if (value.item_id_a === value.item_id_b)
              throw new CloudError(
                "VALIDATION_ERROR",
                400,
                "An Item cannot be associated with itself",
              );
            const [itemA, itemB] = [value.item_id_a, value.item_id_b].sort();
            await this.owned(q, "items", itemA!, ownerId);
            await this.owned(q, "items", itemB!, ownerId);
            const duplicate = await q.query<{ id: string }>(
              `SELECT id FROM item_associations WHERE owner_id=$1 AND item_id_a=$2
               AND item_id_b=$3 AND deleted_at IS NULL`,
              [ownerId, itemA, itemB],
            );
            if (duplicate.rows[0])
              throw new CloudError(
                "VALIDATION_ERROR",
                409,
                "These Items are already associated",
              );
            const result = await q.query<{ value: Record<string, unknown> }>(
              `WITH inserted AS (INSERT INTO item_associations
               (id,owner_id,item_id_a,item_id_b,created_at,deleted_at,row_version)
               VALUES ($1,$2,$3,$4,$5,NULL,1) RETURNING *)
               SELECT row_to_json(inserted) AS value FROM inserted`,
              [id, ownerId, itemA, itemB, value.created_at],
            );
            row = result.rows[0]?.value;
            break;
          }
          case "RAW_CAPTURE_OUTPUT": {
            const value = outputSchema.parse(input);
            await this.owned(q, "raw_captures", value.raw_capture_id, ownerId);
            const target =
              value.object_type === "ITEM" ? "items" : "course_information";
            await this.owned(q, target, value.object_id, ownerId);
            if (value.object_type === "ITEM") {
              const link = await q.query<{ raw_capture_id: string | null }>(
                "SELECT raw_capture_id FROM items WHERE id = $1 AND owner_id = $2",
                [value.object_id, ownerId],
              );
              if (link.rows[0]?.raw_capture_id !== value.raw_capture_id)
                throw new CloudError(
                  "VALIDATION_ERROR",
                  400,
                  "Item provenance does not match output",
                );
            }
            const result = await q.query<{ value: Record<string, unknown> }>(
              `WITH inserted AS (INSERT INTO raw_capture_outputs
               (id,owner_id,raw_capture_id,object_type,object_id,created_at)
               VALUES ($1,$2,$3,$4,$5,$6) RETURNING *)
               SELECT row_to_json(inserted) AS value FROM inserted`,
              [
                id,
                ownerId,
                value.raw_capture_id,
                value.object_type,
                value.object_id,
                value.created_at,
              ],
            );
            row = result.rows[0]?.value;
            break;
          }
          case "RAW_CAPTURE_DECISION": {
            const value = decisionSchema.parse(input);
            await this.owned(q, "raw_captures", value.raw_capture_id, ownerId);
            const result = await q.query<{ value: Record<string, unknown> }>(
              `WITH inserted AS (INSERT INTO raw_capture_decisions
               (id,owner_id,raw_capture_id,decision_type,decision_payload,decided_at,device_id)
               VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7) RETURNING *)
               SELECT row_to_json(inserted) AS value FROM inserted`,
              [
                id,
                ownerId,
                value.raw_capture_id,
                value.decision_type,
                JSON.stringify(value.decision_payload),
                value.decided_at,
                value.device_id,
              ],
            );
            row = result.rows[0]?.value;
            break;
          }
          default:
            throw new CloudError(
              "VALIDATION_ERROR",
              400,
              "Entity is not supported by sync yet",
            );
        }
        if (!row)
          throw new CloudError("SERVER_ERROR", 500, "Sync create failed");
        await insertLog(q, ownerId, mutation, row, 1);
        const response: PushResult = {
          mutation_id: mutation.mutation_id,
          result: "ACK",
          entity_version: 1,
        };
        await q.query(
          "INSERT INTO idempotency_keys (owner_id,mutation_id,request_hash,response) VALUES ($1,$2,$3,$4::jsonb)",
          [ownerId, mutation.mutation_id, hash, JSON.stringify(response)],
        );
        return response;
      });
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "23505"
      ) {
        const prior = await lookup(this.db);
        if (prior) return prior;
        throw new CloudError(
          "VALIDATION_ERROR",
          409,
          mutation.entity_type === "ITEM_ASSOCIATION"
            ? "These Items are already associated"
            : "Entity already exists",
        );
      }
      throw error;
    }
  }

  private async changeRawCapture(
    ownerId: string,
    mutation: SyncMutationInput,
  ): Promise<PushResult> {
    const input =
      mutation.operation === "DELETE"
        ? z
            .object({
              deleted_at: isoDateTimeSchema,
              processing_status: z.literal("DELETED"),
            })
            .strict()
            .parse(mutation.changed_fields)
        : z
            .object({
              processing_status: z
                .enum(["RAW", "PROCESSING", "RESOLVED", "UNRESOLVED"])
                .optional(),
              unresolved_reason: z.string().nullable().optional(),
            })
            .strict()
            .parse(mutation.changed_fields);
    const keys = Object.keys(input);
    if (!keys.length)
      throw new CloudError(
        "VALIDATION_ERROR",
        400,
        "No capture fields changed",
      );
    const hash = createHash("sha256")
      .update(JSON.stringify(mutation))
      .digest("hex");
    const lookup = async (q: QueryPort) => {
      const previous = await q.query<IdempotencyRow>(
        "SELECT request_hash,response FROM idempotency_keys WHERE owner_id = $1 AND mutation_id = $2",
        [ownerId, mutation.mutation_id],
      );
      if (!previous.rows[0]) return null;
      if (previous.rows[0].request_hash !== hash)
        throw new CloudError(
          "IDEMPOTENCY_REPLAY",
          409,
          "Mutation ID was used for different data",
        );
      return previous.rows[0].response;
    };
    return this.db.transaction(async (q) => {
      const prior = await lookup(q);
      if (prior) return prior;
      const found = await q.query<{ value: Record<string, unknown> }>(
        "SELECT row_to_json(r) AS value FROM raw_captures r WHERE id = $1 AND owner_id = $2 FOR UPDATE",
        [mutation.entity_id, ownerId],
      );
      const current = found.rows[0]?.value;
      if (!current)
        throw new CloudError("NOT_FOUND", 404, "Raw capture not found");
      if (mutation.operation === "UPDATE" && current.deleted_at)
        throw new CloudError("NOT_FOUND", 404, "Raw capture was deleted");
      if (
        mutation.operation === "DELETE" &&
        current.processing_status !== "UNRESOLVED" &&
        !current.deleted_at
      )
        throw new CloudError(
          "VALIDATION_ERROR",
          400,
          "Only unresolved captures can be deleted",
        );
      let response: PushResult;
      const same = keys.every(
        (key) => current[key] === input[key as keyof typeof input],
      );
      if (current.row_version !== mutation.base_version && !same) {
        const conflictId = randomUUID();
        await q.query(
          `INSERT INTO sync_conflicts
           (id,owner_id,entity_type,entity_id,local_version,remote_version,conflicting_fields,status,created_at)
           VALUES ($1,$2,'RAW_CAPTURE',$3,$4::jsonb,$5::jsonb,$6::jsonb,'OPEN',now())`,
          [
            conflictId,
            ownerId,
            mutation.entity_id,
            JSON.stringify({ base_version: mutation.base_version, ...input }),
            JSON.stringify(current),
            JSON.stringify(keys),
          ],
        );
        response = {
          mutation_id: mutation.mutation_id,
          result: "CONFLICT",
          conflict_id: conflictId,
        };
      } else if (same) {
        response = {
          mutation_id: mutation.mutation_id,
          result: "ACK",
          entity_version: Number(current.row_version),
        };
      } else {
        const updates = keys
          .map((key, index) => `${key} = $${index + 3}`)
          .join(", ");
        const updated = await q.query<{ row_version: number }>(
          `UPDATE raw_captures SET ${updates}, row_version = row_version + 1
           WHERE id = $1 AND owner_id = $2 RETURNING row_version`,
          [
            mutation.entity_id,
            ownerId,
            ...keys.map((key) => input[key as keyof typeof input]),
          ],
        );
        const version = Number(updated.rows[0]!.row_version);
        await insertLog(q, ownerId, mutation, input, version);
        response = {
          mutation_id: mutation.mutation_id,
          result: "ACK",
          entity_version: version,
        };
      }
      await q.query(
        "INSERT INTO idempotency_keys (owner_id,mutation_id,request_hash,response) VALUES ($1,$2,$3,$4::jsonb)",
        [ownerId, mutation.mutation_id, hash, JSON.stringify(response)],
      );
      return response;
    });
  }

  private async changeAcademicEntity(
    ownerId: string,
    mutation: SyncMutationInput,
  ): Promise<PushResult> {
    if (mutation.operation !== "UPDATE")
      throw new CloudError(
        "VALIDATION_ERROR",
        400,
        "This academic object only supports sync updates",
      );
    const baseVersion = mutation.base_version;
    if (baseVersion === null || baseVersion < 1)
      throw new CloudError(
        "VALIDATION_ERROR",
        400,
        "Academic update needs a base version",
      );
    const semesterPatch = z
      .object({
        name: z.string().trim().min(1).optional(),
        start_date: dateOnlySchema.optional(),
        end_date: dateOnlySchema.optional(),
      })
      .strict();
    const coursePatch = createCourseSchema.partial().strict();
    const input = (
      mutation.entity_type === "SEMESTER" ? semesterPatch : coursePatch
    ).parse(mutation.changed_fields) as Record<string, unknown>;
    const keys = Object.keys(input);
    if (!keys.length)
      throw new CloudError(
        "VALIDATION_ERROR",
        400,
        "No academic fields changed",
      );
    const table = mutation.entity_type === "SEMESTER" ? "semesters" : "courses";
    const hash = createHash("sha256")
      .update(JSON.stringify(mutation))
      .digest("hex");
    return this.db.transaction(async (query) => {
      const prior = await query.query<IdempotencyRow>(
        "SELECT request_hash,response FROM idempotency_keys WHERE owner_id=$1 AND mutation_id=$2",
        [ownerId, mutation.mutation_id],
      );
      if (prior.rows[0]) {
        if (prior.rows[0].request_hash !== hash)
          throw new CloudError(
            "IDEMPOTENCY_REPLAY",
            409,
            "Mutation ID was used for different data",
          );
        return prior.rows[0].response;
      }
      const found = await query.query<{ value: Record<string, unknown> }>(
        `SELECT row_to_json(e) AS value FROM ${table} e WHERE id=$1 AND owner_id=$2 FOR UPDATE`,
        [mutation.entity_id, ownerId],
      );
      const current = found.rows[0]?.value;
      if (!current || current.deleted_at)
        throw new CloudError("NOT_FOUND", 404, "Academic object not found");
      if (baseVersion > Number(current.row_version))
        throw new CloudError(
          "VALIDATION_ERROR",
          400,
          "Base version is newer than the stored object",
        );
      const same = keys.every((key) => current[key] === input[key]);
      let response: PushResult;
      if (same) {
        response = {
          mutation_id: mutation.mutation_id,
          result: "ACK",
          entity_version: Number(current.row_version),
        };
      } else {
        const changedSinceBase = await query.query<{
          changed_fields: Record<string, unknown>;
        }>(
          `SELECT changed_fields FROM change_log WHERE owner_id=$1 AND entity_type=$2
           AND entity_id=$3 AND entity_version>$4 ORDER BY entity_version`,
          [ownerId, mutation.entity_type, mutation.entity_id, baseVersion],
        );
        const remoteFields = new Set(
          changedSinceBase.rows.flatMap((entry) =>
            Object.keys(entry.changed_fields ?? {}),
          ),
        );
        const conflicting =
          Number(current.row_version) === baseVersion
            ? []
            : keys.filter((key) => remoteFields.has(key));
        if (conflicting.length) {
          const conflictId = randomUUID();
          await query.query(
            `INSERT INTO sync_conflicts
             (id,owner_id,entity_type,entity_id,local_version,remote_version,
              conflicting_fields,status,created_at)
             VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,'OPEN',now())`,
            [
              conflictId,
              ownerId,
              mutation.entity_type,
              mutation.entity_id,
              JSON.stringify({ base_version: baseVersion, ...input }),
              JSON.stringify(current),
              JSON.stringify(conflicting),
            ],
          );
          response = {
            mutation_id: mutation.mutation_id,
            result: "CONFLICT",
            conflict_id: conflictId,
          };
        } else {
          const merged = { ...current, ...input };
          if (mutation.entity_type === "SEMESTER") {
            if (String(merged.start_date) > String(merged.end_date))
              throw new CloudError(
                "VALIDATION_ERROR",
                400,
                "Invalid Semester dates",
              );
          } else if (merged.semester_id) {
            const semester = await query.query<{ id: string }>(
              "SELECT id FROM semesters WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL",
              [merged.semester_id, ownerId],
            );
            if (!semester.rows[0])
              throw new CloudError("NOT_FOUND", 404, "Semester not found");
          }
          const assignments = keys.map((key, index) => `${key}=$${index + 3}`);
          assignments.push("updated_at=now()", "row_version=row_version+1");
          const updated = await query.query<{ value: Record<string, unknown> }>(
            `WITH changed AS (UPDATE ${table} SET ${assignments.join(",")}
             WHERE id=$1 AND owner_id=$2 RETURNING *)
             SELECT row_to_json(changed) AS value FROM changed`,
            [mutation.entity_id, ownerId, ...keys.map((key) => input[key])],
          );
          const value = updated.rows[0]!.value;
          await insertLog(
            query,
            ownerId,
            mutation,
            input,
            Number(value.row_version),
          );
          response = {
            mutation_id: mutation.mutation_id,
            result: "ACK",
            entity_version: Number(value.row_version),
          };
        }
      }
      await query.query(
        "INSERT INTO idempotency_keys (owner_id,mutation_id,request_hash,response) VALUES ($1,$2,$3,$4::jsonb)",
        [ownerId, mutation.mutation_id, hash, JSON.stringify(response)],
      );
      return response;
    });
  }

  private async changeInformation(
    ownerId: string,
    mutation: SyncMutationInput,
  ): Promise<PushResult> {
    const input =
      mutation.operation === "DELETE"
        ? z
            .object({ deleted_at: isoDateTimeSchema })
            .strict()
            .parse(mutation.changed_fields)
        : z
            .object({ content: z.string().trim().min(1) })
            .strict()
            .parse(mutation.changed_fields);
    const key = mutation.operation === "DELETE" ? "deleted_at" : "content";
    const desired = input[key as keyof typeof input];
    const hash = createHash("sha256")
      .update(JSON.stringify(mutation))
      .digest("hex");
    return this.db.transaction(async (q) => {
      const previous = await q.query<IdempotencyRow>(
        "SELECT request_hash,response FROM idempotency_keys WHERE owner_id = $1 AND mutation_id = $2",
        [ownerId, mutation.mutation_id],
      );
      if (previous.rows[0]) {
        if (previous.rows[0].request_hash !== hash)
          throw new CloudError(
            "IDEMPOTENCY_REPLAY",
            409,
            "Mutation ID was used for different data",
          );
        return previous.rows[0].response;
      }
      const found = await q.query<{ value: Record<string, unknown> }>(
        "SELECT row_to_json(c) AS value FROM course_information c WHERE id = $1 AND owner_id = $2 FOR UPDATE",
        [mutation.entity_id, ownerId],
      );
      const current = found.rows[0]?.value;
      if (!current)
        throw new CloudError("NOT_FOUND", 404, "Course information not found");
      if (mutation.operation === "UPDATE" && current.deleted_at)
        throw new CloudError(
          "NOT_FOUND",
          404,
          "Course information was deleted",
        );
      let response: PushResult;
      if (
        current.row_version !== mutation.base_version &&
        current[key] !== desired
      ) {
        const conflictId = randomUUID();
        await q.query(
          `INSERT INTO sync_conflicts
           (id,owner_id,entity_type,entity_id,local_version,remote_version,conflicting_fields,status,created_at)
           VALUES ($1,$2,'COURSE_INFORMATION',$3,$4::jsonb,$5::jsonb,$6::jsonb,'OPEN',now())`,
          [
            conflictId,
            ownerId,
            mutation.entity_id,
            JSON.stringify({ base_version: mutation.base_version, ...input }),
            JSON.stringify(current),
            JSON.stringify([key]),
          ],
        );
        response = {
          mutation_id: mutation.mutation_id,
          result: "CONFLICT",
          conflict_id: conflictId,
        };
      } else if (current[key] === desired) {
        response = {
          mutation_id: mutation.mutation_id,
          result: "ACK",
          entity_version: Number(current.row_version),
        };
      } else {
        const updated = await q.query<{ row_version: number }>(
          `UPDATE course_information SET ${key} = $3, updated_at = now(), row_version = row_version + 1
           WHERE id = $1 AND owner_id = $2 RETURNING row_version`,
          [mutation.entity_id, ownerId, desired],
        );
        const version = Number(updated.rows[0]!.row_version);
        await insertLog(q, ownerId, mutation, input, version);
        response = {
          mutation_id: mutation.mutation_id,
          result: "ACK",
          entity_version: version,
        };
      }
      await q.query(
        "INSERT INTO idempotency_keys (owner_id,mutation_id,request_hash,response) VALUES ($1,$2,$3,$4::jsonb)",
        [ownerId, mutation.mutation_id, hash, JSON.stringify(response)],
      );
      return response;
    });
  }

  private async deleteSemesterWeek(
    ownerId: string,
    mutation: SyncMutationInput,
  ): Promise<PushResult> {
    const input = z
      .object({ id: uuidSchema })
      .strict()
      .parse(mutation.changed_fields);
    if (input.id !== mutation.entity_id)
      throw new CloudError("VALIDATION_ERROR", 400, "Week identity mismatch");
    const hash = createHash("sha256")
      .update(JSON.stringify(mutation))
      .digest("hex");
    return this.db.transaction(async (q) => {
      const previous = await q.query<IdempotencyRow>(
        "SELECT request_hash,response FROM idempotency_keys WHERE owner_id = $1 AND mutation_id = $2",
        [ownerId, mutation.mutation_id],
      );
      if (previous.rows[0]) {
        if (previous.rows[0].request_hash !== hash)
          throw new CloudError(
            "IDEMPOTENCY_REPLAY",
            409,
            "Mutation ID was used for different data",
          );
        return previous.rows[0].response;
      }
      const deleted = await q.query<{ semester_id: string }>(
        "DELETE FROM semester_weeks WHERE id = $1 AND owner_id = $2 RETURNING semester_id",
        [mutation.entity_id, ownerId],
      );
      if (!deleted.rows[0])
        throw new CloudError("NOT_FOUND", 404, "Semester week not found");
      await insertLog(
        q,
        ownerId,
        mutation,
        { id: mutation.entity_id, semester_id: deleted.rows[0].semester_id },
        2,
      );
      const response: PushResult = {
        mutation_id: mutation.mutation_id,
        result: "ACK",
        entity_version: 2,
      };
      await q.query(
        "INSERT INTO idempotency_keys (owner_id,mutation_id,request_hash,response) VALUES ($1,$2,$3,$4::jsonb)",
        [ownerId, mutation.mutation_id, hash, JSON.stringify(response)],
      );
      return response;
    });
  }

  private async deleteCourseSchedule(
    ownerId: string,
    mutation: SyncMutationInput,
  ): Promise<PushResult> {
    const input = z
      .object({ deleted_at: isoDateTimeSchema })
      .strict()
      .parse(mutation.changed_fields);
    const base = mutation.base_version;
    if (base === null || base < 1)
      throw new CloudError(
        "VALIDATION_ERROR",
        400,
        "Schedule deletion needs a base version",
      );
    const hash = createHash("sha256")
      .update(JSON.stringify(mutation))
      .digest("hex");
    return this.db.transaction(async (q) => {
      const previous = await q.query<IdempotencyRow>(
        "SELECT request_hash,response FROM idempotency_keys WHERE owner_id = $1 AND mutation_id = $2",
        [ownerId, mutation.mutation_id],
      );
      if (previous.rows[0]) {
        if (previous.rows[0].request_hash !== hash)
          throw new CloudError(
            "IDEMPOTENCY_REPLAY",
            409,
            "Mutation ID was used for different data",
          );
        return previous.rows[0].response;
      }
      const updated = await q.query<{ value: Record<string, unknown> }>(
        `WITH changed AS (UPDATE course_schedules SET deleted_at = $4, updated_at = $4,
         row_version = row_version + 1 WHERE id = $1 AND owner_id = $2 AND row_version = $3
         AND deleted_at IS NULL RETURNING *) SELECT row_to_json(changed) AS value FROM changed`,
        [mutation.entity_id, ownerId, base, input.deleted_at],
      );
      if (!updated.rows[0]) {
        const existing = await q.query<{ row_version: number }>(
          "SELECT row_version FROM course_schedules WHERE id = $1 AND owner_id = $2",
          [mutation.entity_id, ownerId],
        );
        if (!existing.rows[0])
          throw new CloudError("NOT_FOUND", 404, "Course schedule not found");
        throw new CloudError(
          "VERSION_CONFLICT",
          409,
          "Course schedule changed on another device",
        );
      }
      const version = Number(updated.rows[0].value.row_version);
      await insertLog(q, ownerId, mutation, updated.rows[0].value, version);
      const response: PushResult = {
        mutation_id: mutation.mutation_id,
        result: "ACK",
        entity_version: version,
      };
      await q.query(
        "INSERT INTO idempotency_keys (owner_id,mutation_id,request_hash,response) VALUES ($1,$2,$3,$4::jsonb)",
        [ownerId, mutation.mutation_id, hash, JSON.stringify(response)],
      );
      return response;
    });
  }

  private async deleteAssociation(
    ownerId: string,
    mutation: SyncMutationInput,
  ): Promise<PushResult> {
    const input = z
      .object({ deleted_at: isoDateTimeSchema })
      .strict()
      .parse(mutation.changed_fields);
    if (mutation.base_version === null || mutation.base_version < 1)
      throw new CloudError(
        "VALIDATION_ERROR",
        400,
        "Association deletion needs a base version",
      );
    const hash = createHash("sha256")
      .update(JSON.stringify(mutation))
      .digest("hex");
    return this.db.transaction(async (q) => {
      const previous = await q.query<IdempotencyRow>(
        "SELECT request_hash,response FROM idempotency_keys WHERE owner_id=$1 AND mutation_id=$2",
        [ownerId, mutation.mutation_id],
      );
      if (previous.rows[0]) {
        if (previous.rows[0].request_hash !== hash)
          throw new CloudError(
            "IDEMPOTENCY_REPLAY",
            409,
            "Mutation ID was used for different data",
          );
        return previous.rows[0].response;
      }
      const found = await q.query<{
        value: Record<string, unknown>;
      }>(
        "SELECT row_to_json(a) AS value FROM item_associations a WHERE id=$1 AND owner_id=$2 FOR UPDATE",
        [mutation.entity_id, ownerId],
      );
      const current = found.rows[0]?.value;
      if (!current)
        throw new CloudError("NOT_FOUND", 404, "Item association not found");
      let version = Number(current.row_version);
      if (!current.deleted_at) {
        if (version !== mutation.base_version)
          throw new CloudError(
            "VERSION_CONFLICT",
            409,
            "Item association changed on another device",
          );
        const changed = await q.query<{ value: Record<string, unknown> }>(
          `WITH updated AS (UPDATE item_associations SET deleted_at=$3,
           row_version=row_version+1 WHERE id=$1 AND owner_id=$2 RETURNING *)
           SELECT row_to_json(updated) AS value FROM updated`,
          [mutation.entity_id, ownerId, input.deleted_at],
        );
        version = Number(changed.rows[0]!.value.row_version);
        await insertLog(q, ownerId, mutation, changed.rows[0]!.value, version);
      }
      const response: PushResult = {
        mutation_id: mutation.mutation_id,
        result: "ACK",
        entity_version: version,
      };
      await q.query(
        "INSERT INTO idempotency_keys (owner_id,mutation_id,request_hash,response) VALUES ($1,$2,$3,$4::jsonb)",
        [ownerId, mutation.mutation_id, hash, JSON.stringify(response)],
      );
      return response;
    });
  }

  async pushOne(
    ownerId: string,
    mutation: SyncMutationInput,
  ): Promise<PushResult> {
    if (isCollectionSyncType(mutation.entity_type))
      return this.collections.replace(ownerId, {
        ...mutation,
        entity_type: mutation.entity_type,
      });
    if (mutation.operation === "CREATE") {
      if (mutation.base_version !== null)
        throw new CloudError(
          "VALIDATION_ERROR",
          400,
          "Create must not have a base version",
        );
      return this.create(ownerId, mutation);
    }
    if (
      mutation.entity_type === "SEMESTER_WEEK" &&
      mutation.operation === "DELETE"
    )
      return this.deleteSemesterWeek(ownerId, mutation);
    if (
      mutation.entity_type === "COURSE_SCHEDULE" &&
      mutation.operation === "DELETE"
    )
      return this.deleteCourseSchedule(ownerId, mutation);
    if (
      mutation.entity_type === "ITEM_ASSOCIATION" &&
      mutation.operation === "DELETE"
    )
      return this.deleteAssociation(ownerId, mutation);
    const base = mutation.base_version;
    if (base === null || base < 1)
      throw new CloudError(
        "VALIDATION_ERROR",
        400,
        "Mutation needs a base version",
      );
    const fields = mutation.changed_fields;
    if (mutation.entity_type === "COURSE" && mutation.operation === "DELETE") {
      const input = z
        .object({
          strategy: z.enum([
            "DELETE_ASSOCIATED_ITEMS",
            "UNLINK_ASSOCIATED_ITEMS",
          ]),
          deleted_at: isoDateTimeSchema,
          item_versions: z.array(
            z.object({
              id: uuidSchema,
              row_version: z.number().int().positive(),
            }),
          ),
        })
        .strict()
        .parse(fields);
      const result = await this.items.deleteCourseWithStrategy(
        ownerId,
        mutation.entity_id,
        mutation.mutation_id,
        base,
        input.strategy,
        input.item_versions,
        input.deleted_at,
      );
      return {
        mutation_id: mutation.mutation_id,
        result: "ACK",
        entity_version: result.course.row_version,
      };
    }
    if (
      mutation.entity_type === "SEMESTER" &&
      mutation.operation === "DELETE"
    ) {
      const input = z
        .object({
          deleted_at: isoDateTimeSchema,
          updated_at: isoDateTimeSchema,
        })
        .strict()
        .parse(fields);
      const result = await this.items.deleteSemesterCascade(
        ownerId,
        mutation.entity_id,
        mutation.mutation_id,
        base,
        input.deleted_at,
      );
      return {
        mutation_id: mutation.mutation_id,
        result: "ACK",
        entity_version: result.semester.row_version,
      };
    }
    if (mutation.entity_type === "RAW_CAPTURE")
      return this.changeRawCapture(ownerId, mutation);
    if (
      mutation.entity_type === "SEMESTER" ||
      mutation.entity_type === "COURSE"
    )
      return this.changeAcademicEntity(ownerId, mutation);
    if (mutation.entity_type === "COURSE_INFORMATION")
      return this.changeInformation(ownerId, mutation);
    if (mutation.entity_type !== "ITEM")
      throw new CloudError(
        "VALIDATION_ERROR",
        400,
        "Entity mutation is not supported by sync yet",
      );
    try {
      if (mutation.operation === "DELETE") {
        const validated = z
          .object({ deleted_at: isoDateTimeSchema, undo_token: uuidSchema })
          .strict()
          .parse(fields);
        const token = validated.undo_token;
        const result = await this.items.deleteItem(
          ownerId,
          mutation.entity_id,
          mutation.mutation_id,
          base,
          token,
        );
        return {
          mutation_id: mutation.mutation_id,
          result: "ACK",
          entity_version: result.item.row_version,
          undo_expires_at: result.undo_expires_at,
        };
      }
      if (fields.deleted_at === null) {
        const { undo_token: token } = z
          .object({ deleted_at: z.null(), undo_token: uuidSchema })
          .strict()
          .parse(fields);
        const item = await this.items.undoDelete(
          ownerId,
          mutation.entity_id,
          mutation.mutation_id,
          token,
        );
        return {
          mutation_id: mutation.mutation_id,
          result: "ACK",
          entity_version: item.row_version,
        };
      }
      if (fields.status === "COMPLETE" || fields.status === "INCOMPLETE") {
        z.object({
          status: z.enum(["COMPLETE", "INCOMPLETE"]),
          completed_at: isoDateTimeSchema.nullable(),
        })
          .strict()
          .parse(fields);
        const item = await this.items.setItemComplete(
          ownerId,
          mutation.entity_id,
          mutation.mutation_id,
          base,
          fields.status === "COMPLETE",
        );
        return {
          mutation_id: mutation.mutation_id,
          result: "ACK",
          entity_version: item.row_version,
        };
      }
      const item = await this.items.updateItem(
        ownerId,
        mutation.entity_id,
        mutation.mutation_id,
        base,
        fields,
      );
      return {
        mutation_id: mutation.mutation_id,
        result: "ACK",
        entity_version: item.row_version,
      };
    } catch (error) {
      if (error instanceof CloudError && error.code === "VERSION_CONFLICT")
        return {
          mutation_id: mutation.mutation_id,
          result: "CONFLICT",
          conflict_id: String(error.details.conflict_id),
        };
      throw error;
    }
  }

  async changes(ownerId: string, cursor: string | undefined, limit: number) {
    let after = "0";
    if (cursor) {
      try {
        const payload = z
          .object({
            v: z.literal(1),
            owner: uuidSchema,
            after: z.string().regex(/^\d+$/),
          })
          .parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
        if (payload.owner !== ownerId) throw new Error("Wrong owner");
        after = payload.after;
      } catch {
        throw new CloudError("SYNC_CURSOR_INVALID", 400, "Invalid sync cursor");
      }
    }
    const result = await this.db.query<{
      id: string | number;
      entity_type: string;
      entity_id: string;
      operation: string;
      changed_fields: Record<string, unknown>;
      entity_version: number;
      server_time: string;
    }>(
      "SELECT id,entity_type,entity_id,operation,changed_fields,entity_version,server_time FROM change_log WHERE owner_id = $1 AND id > $2 ORDER BY id LIMIT $3",
      [ownerId, after, limit + 1],
    );
    const data = result.rows
      .slice(0, limit)
      .map((row) => ({ ...row, id: String(row.id) }));
    const last = data.at(-1)?.id ?? after;
    return {
      data,
      next_cursor: Buffer.from(
        JSON.stringify({ v: 1, owner: ownerId, after: last }),
        "utf8",
      ).toString("base64url"),
      has_more: result.rows.length > limit,
    };
  }
}
