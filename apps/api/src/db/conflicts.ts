import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import {
  createItemSchema,
  createCourseSchema,
  dateOnlySchema,
  isoDateTimeSchema,
  itemStatusSchema,
  rawCaptureStatusSchema,
  conflictResolutionSchema,
  type ConflictResolution,
} from "@course-manager/contracts";
import type { SyncConflict } from "@course-manager/domain";
import { CloudError, type CloudDatabase, type QueryPort } from "./cloud.js";
import {
  currentCollectionDescriptor,
  isCollectionSyncType,
  resolveCollectionWithinTransaction,
} from "./collections.js";

export { conflictResolutionSchema };

type ConflictRow = SyncConflict & {
  resolution?: Record<string, unknown> | null;
};
type SupportedType =
  "ITEM" | "COURSE_INFORMATION" | "RAW_CAPTURE" | "SEMESTER" | "COURSE";
const tables: Record<SupportedType, string> = {
  ITEM: "items",
  COURSE_INFORMATION: "course_information",
  RAW_CAPTURE: "raw_captures",
  SEMESTER: "semesters",
  COURSE: "courses",
};
const allowedFields: Record<SupportedType, Set<string>> = {
  ITEM: new Set([
    "title",
    "detail",
    "course_id",
    "start_at",
    "occurrence_start_at",
    "occurrence_end_at",
    "due_at",
    "reminder_level",
    "status",
    "deleted_at",
  ]),
  COURSE_INFORMATION: new Set(["content", "deleted_at"]),
  RAW_CAPTURE: new Set([
    "processing_status",
    "unresolved_reason",
    "deleted_at",
  ]),
  SEMESTER: new Set(["name", "start_date", "end_date"]),
  COURSE: new Set(["name", "semester_id", "instructor"]),
};

export class CloudConflictManager {
  constructor(private readonly db: CloudDatabase) {}

  private async entity(
    query: QueryPort,
    ownerId: string,
    type: SupportedType,
    id: string,
    lock = false,
  ): Promise<Record<string, unknown> | null> {
    const table = tables[type];
    const result = await query.query<{ value: Record<string, unknown> }>(
      `SELECT row_to_json(e) AS value FROM ${table} e WHERE id=$1 AND owner_id=$2${lock ? " FOR UPDATE" : ""}`,
      [id, ownerId],
    );
    return result.rows[0]?.value ?? null;
  }

  private async conflict(
    query: QueryPort,
    ownerId: string,
    id: string,
    lock = false,
  ): Promise<ConflictRow | null> {
    const result = await query.query<{ value: ConflictRow }>(
      `SELECT row_to_json(c) AS value FROM sync_conflicts c WHERE id=$1 AND owner_id=$2${lock ? " FOR UPDATE" : ""}`,
      [id, ownerId],
    );
    return result.rows[0]?.value ?? null;
  }

  async list(ownerId: string): Promise<ConflictRow[]> {
    const result = await this.db.query<{ value: ConflictRow }>(
      "SELECT row_to_json(c) AS value FROM sync_conflicts c WHERE owner_id=$1 AND status='OPEN' ORDER BY created_at,id",
      [ownerId],
    );
    return result.rows.map((row) => row.value);
  }

  async get(ownerId: string, id: string) {
    return this.db.transaction(async (query) => {
      const conflict = await this.conflict(query, ownerId, id, true);
      if (!conflict)
        throw new CloudError("NOT_FOUND", 404, "Conflict not found");
      if (isCollectionSyncType(conflict.entity_type))
        return {
          conflict,
          current_entity: await currentCollectionDescriptor(
            query,
            ownerId,
            conflict.entity_type,
            conflict.entity_id,
            true,
          ),
        };
      if (!(conflict.entity_type in tables))
        throw new CloudError(
          "VALIDATION_ERROR",
          400,
          "Conflict type cannot be resolved here",
        );
      const current_entity = await this.entity(
        query,
        ownerId,
        conflict.entity_type as SupportedType,
        conflict.entity_id,
      );
      if (!current_entity)
        throw new CloudError("NOT_FOUND", 404, "Conflicting object not found");
      return { conflict, current_entity };
    });
  }

  async resolve(
    ownerId: string,
    id: string,
    mutationId: string,
    observedVersion: number,
    request: ConflictResolution,
  ) {
    const hash = createHash("sha256")
      .update(JSON.stringify({ id, observedVersion, request }))
      .digest("hex");
    const lookup = async (query: QueryPort) => {
      const result = await query.query<{
        request_hash: string;
        response: Record<string, unknown>;
      }>(
        "SELECT request_hash,response FROM idempotency_keys WHERE owner_id=$1 AND mutation_id=$2",
        [ownerId, mutationId],
      );
      if (!result.rows[0]) return null;
      if (result.rows[0].request_hash !== hash)
        throw new CloudError(
          "IDEMPOTENCY_REPLAY",
          409,
          "Idempotency key was used for different data",
        );
      return result.rows[0].response;
    };
    return this.db.transaction(async (query) => {
      const prior = await lookup(query);
      if (prior) return prior;
      const conflict = await this.conflict(query, ownerId, id, true);
      if (!conflict)
        throw new CloudError("NOT_FOUND", 404, "Conflict not found");
      if (conflict.status !== "OPEN")
        throw new CloudError(
          "VERSION_CONFLICT",
          409,
          "Conflict was already resolved",
        );
      if (isCollectionSyncType(conflict.entity_type)) {
        const fields = conflict.conflicting_fields;
        const choice = request.field_resolutions.collection;
        if (
          fields.length !== 1 ||
          fields[0] !== "collection" ||
          Object.keys(request.field_resolutions).length !== 1 ||
          (choice !== "LOCAL" && choice !== "REMOTE")
        )
          throw new CloudError(
            "VALIDATION_ERROR",
            400,
            "Choose the local or synced collection",
          );
        const entity = await resolveCollectionWithinTransaction(
          query,
          ownerId,
          conflict.entity_type,
          conflict.entity_id,
          observedVersion,
          choice,
          conflict.local_version.collection,
        );
        const resolution = {
          ...request,
          selected: { collection: choice },
          observed_version: observedVersion,
        };
        await query.query(
          "UPDATE sync_conflicts SET status='RESOLVED',resolved_at=now(),resolution=$3::jsonb WHERE id=$1 AND owner_id=$2",
          [id, ownerId, JSON.stringify(resolution)],
        );
        const resolved = await this.conflict(query, ownerId, id);
        const response = { conflict: resolved!, entity };
        await query.query(
          "INSERT INTO idempotency_keys (owner_id,mutation_id,request_hash,response) VALUES ($1,$2,$3,$4::jsonb)",
          [ownerId, mutationId, hash, JSON.stringify(response)],
        );
        return response;
      }
      if (!(conflict.entity_type in tables))
        throw new CloudError(
          "VALIDATION_ERROR",
          400,
          "Unsupported conflict type",
        );
      const type = conflict.entity_type as SupportedType;
      const current = await this.entity(
        query,
        ownerId,
        type,
        conflict.entity_id,
        true,
      );
      if (!current)
        throw new CloudError("NOT_FOUND", 404, "Conflicting object not found");
      if (Number(current.row_version) !== observedVersion)
        throw new CloudError(
          "VERSION_CONFLICT",
          409,
          "Conflicting object changed since review",
          { current_version: current.row_version },
        );
      const fields = conflict.conflicting_fields;
      if (
        fields.length === 0 ||
        Object.keys(request.field_resolutions).length !== fields.length ||
        fields.some(
          (field) =>
            !(field in request.field_resolutions) ||
            !allowedFields[type].has(field),
        )
      )
        throw new CloudError(
          "VALIDATION_ERROR",
          400,
          "Choose every conflicting field",
        );
      if (
        current.deleted_at &&
        fields.some((field) => request.field_resolutions[field] !== "REMOTE")
      )
        throw new CloudError(
          "FORBIDDEN",
          403,
          "A deleted object cannot be changed by conflict resolution",
        );
      const selected: Record<string, unknown> = {};
      for (const field of fields) {
        const choice = request.field_resolutions[field]!;
        if (choice === "LOCAL") {
          if (!(field in conflict.local_version))
            throw new CloudError(
              "VALIDATION_ERROR",
              400,
              "Local value is unavailable",
            );
          selected[field] = conflict.local_version[field];
        } else if (choice === "REMOTE") {
          selected[field] = current[field];
        } else {
          selected[field] = choice.value;
        }
      }
      const deletingItem =
        type === "ITEM" &&
        "deleted_at" in selected &&
        Boolean(selected.deleted_at);
      let undoToken: string | null = null;
      let undoExpiresAt: string | null = null;
      if (deletingItem) {
        selected.deleted_at = new Date().toISOString();
        undoToken =
          typeof conflict.local_version.undo_token === "string"
            ? conflict.local_version.undo_token
            : randomBytes(32).toString("base64url");
        undoExpiresAt = new Date(Date.now() + 10_000).toISOString();
      }
      if (type === "ITEM") {
        if ("status" in selected) {
          itemStatusSchema.parse(selected.status);
          selected.completed_at =
            selected.status === "COMPLETE" ? new Date().toISOString() : null;
        }
        createItemSchema.parse({ ...current, ...selected });
        if (selected.course_id) {
          const course = await query.query<{ id: string }>(
            "SELECT id FROM courses WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL",
            [selected.course_id, ownerId],
          );
          if (!course.rows[0])
            throw new CloudError("NOT_FOUND", 404, "Course not found");
        }
      } else if (type === "COURSE_INFORMATION") {
        if ("content" in selected)
          z.string().trim().min(1).max(20000).parse(selected.content);
      } else if (type === "RAW_CAPTURE") {
        if ("processing_status" in selected)
          rawCaptureStatusSchema.parse(selected.processing_status);
        if ("unresolved_reason" in selected)
          z.string().nullable().parse(selected.unresolved_reason);
        const nextCapture = { ...current, ...selected };
        if (
          (nextCapture.processing_status === "DELETED") !==
          Boolean(nextCapture.deleted_at)
        )
          throw new CloudError(
            "VALIDATION_ERROR",
            400,
            "Deleted capture needs a matching tombstone and status",
          );
        if (selected.deleted_at && current.processing_status !== "UNRESOLVED")
          throw new CloudError(
            "VALIDATION_ERROR",
            400,
            "Only unresolved captures can be deleted",
          );
      } else if (type === "SEMESTER") {
        const nextSemester = { ...current, ...selected };
        z.string().trim().min(1).parse(nextSemester.name);
        dateOnlySchema.parse(nextSemester.start_date);
        dateOnlySchema.parse(nextSemester.end_date);
        if (String(nextSemester.start_date) > String(nextSemester.end_date))
          throw new CloudError(
            "VALIDATION_ERROR",
            400,
            "Invalid Semester dates",
          );
      } else {
        const nextCourse = createCourseSchema.parse({
          ...current,
          ...selected,
        });
        if (nextCourse.semester_id) {
          const semester = await query.query<{ id: string }>(
            "SELECT id FROM semesters WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL",
            [nextCourse.semester_id, ownerId],
          );
          if (!semester.rows[0])
            throw new CloudError("NOT_FOUND", 404, "Semester not found");
        }
      }
      if ("deleted_at" in selected) {
        if (selected.deleted_at !== null)
          isoDateTimeSchema.parse(selected.deleted_at);
        if (current.deleted_at && selected.deleted_at === null)
          throw new CloudError(
            "FORBIDDEN",
            403,
            "Conflict resolution cannot undo deletion",
          );
      }
      const keys = Object.keys(selected);
      const assignments = keys.map((key, index) => `${key}=$${index + 3}`);
      if (type !== "RAW_CAPTURE") assignments.push("updated_at=now()");
      assignments.push("row_version=row_version+1");
      const updated = await query.query<{ value: Record<string, unknown> }>(
        `WITH changed AS (UPDATE ${tables[type]} SET ${assignments.join(", ")} WHERE id=$1 AND owner_id=$2 RETURNING *) SELECT row_to_json(changed) AS value FROM changed`,
        [conflict.entity_id, ownerId, ...keys.map((key) => selected[key])],
      );
      const entity = updated.rows[0]?.value;
      if (!entity)
        throw new CloudError("SERVER_ERROR", 500, "Conflict resolution failed");
      if (undoToken && undoExpiresAt) {
        await query.query(
          `INSERT INTO delete_undo_tokens (owner_id,item_id,token_hash,expires_at)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (owner_id,item_id)
           DO UPDATE SET token_hash=EXCLUDED.token_hash,expires_at=EXCLUDED.expires_at,consumed_at=NULL`,
          [
            ownerId,
            conflict.entity_id,
            createHash("sha256").update(undoToken).digest("hex"),
            undoExpiresAt,
          ],
        );
      }
      await query.query(
        "INSERT INTO change_log (owner_id,entity_type,entity_id,operation,changed_fields,entity_version) VALUES ($1,$2,$3,$4,$5::jsonb,$6)",
        [
          ownerId,
          type,
          conflict.entity_id,
          selected.deleted_at && !current.deleted_at ? "DELETE" : "UPDATE",
          JSON.stringify(selected),
          entity.row_version,
        ],
      );
      const resolution = {
        ...request,
        selected,
        observed_version: observedVersion,
      };
      await query.query(
        "UPDATE sync_conflicts SET status='RESOLVED',resolved_at=now(),resolution=$3::jsonb WHERE id=$1 AND owner_id=$2",
        [id, ownerId, JSON.stringify(resolution)],
      );
      const resolved = await this.conflict(query, ownerId, id);
      const response = {
        conflict: resolved!,
        entity,
        ...(undoToken && undoExpiresAt
          ? { undo_token: undoToken, undo_expires_at: undoExpiresAt }
          : {}),
      };
      await query.query(
        "INSERT INTO idempotency_keys (owner_id,mutation_id,request_hash,response) VALUES ($1,$2,$3,$4::jsonb)",
        [ownerId, mutationId, hash, JSON.stringify(response)],
      );
      return response;
    });
  }
}
