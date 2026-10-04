import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  dateOnlySchema,
  isoDateTimeSchema,
  uuidSchema,
} from "@course-manager/contracts";
import type { CourseSchedule, SemesterWeek } from "@course-manager/domain";
import { CloudError, type CloudDatabase, type QueryPort } from "./cloud.js";

export type CollectionSyncType =
  "SEMESTER_WEEK_COLLECTION" | "COURSE_SCHEDULE_COLLECTION";

export function isCollectionSyncType(
  value: string,
): value is CollectionSyncType {
  return (
    value === "SEMESTER_WEEK_COLLECTION" ||
    value === "COURSE_SCHEDULE_COLLECTION"
  );
}

const semesterWeekMemberSchema = z
  .object({
    id: uuidSchema,
    semester_id: uuidSchema,
    week_number: z.number().int().positive(),
    start_date: dateOnlySchema,
    end_date: dateOnlySchema,
  })
  .strict();

const scheduleMemberSchema = z
  .object({
    id: uuidSchema,
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
  .strict();

const weekCollectionSchema = z
  .object({
    previous_collection: z.array(semesterWeekMemberSchema).max(1000),
    collection: z.array(semesterWeekMemberSchema).max(1000),
  })
  .strict();

const scheduleCollectionSchema = z
  .object({
    previous_collection: z.array(scheduleMemberSchema).max(1000),
    collection: z.array(scheduleMemberSchema).max(1000),
  })
  .strict();

type WeekMember = z.infer<typeof semesterWeekMemberSchema>;
type ScheduleMember = z.infer<typeof scheduleMemberSchema>;
export type CollectionMember = WeekMember | ScheduleMember;

export interface CollectionMutationInput {
  mutation_id: string;
  entity_type: CollectionSyncType;
  entity_id: string;
  operation: "CREATE" | "UPDATE" | "DELETE";
  base_version: number | null;
  changed_fields: Record<string, unknown>;
}

export type CollectionPushResult =
  | { mutation_id: string; result: "ACK"; entity_version: number }
  | { mutation_id: string; result: "CONFLICT"; conflict_id: string };

interface CollectionRevision {
  collection_version: number;
  snapshot_hash: string;
}

interface IdempotencyRow {
  request_hash: string;
  response: CollectionPushResult;
}

function time(value: string | null): string | null {
  if (value === null) return null;
  return value.length === 5 ? `${value}:00` : value;
}

function comparable(
  type: CollectionSyncType,
  member: object,
): Record<string, unknown> {
  const value = member as Record<string, unknown>;
  if (type === "SEMESTER_WEEK_COLLECTION")
    return {
      id: value.id,
      semester_id: value.semester_id,
      week_number: Number(value.week_number),
      start_date: String(value.start_date),
      end_date: String(value.end_date),
    };
  return {
    id: value.id,
    course_id: value.course_id,
    weekday: Number(value.weekday),
    start_time:
      value.start_time === null || value.start_time === undefined
        ? null
        : time(String(value.start_time)),
    end_time:
      value.end_time === null || value.end_time === undefined
        ? null
        : time(String(value.end_time)),
    week_start: value.week_start === null ? null : Number(value.week_start),
    week_end: value.week_end === null ? null : Number(value.week_end),
    classroom: value.classroom ?? null,
    stage_label: value.stage_label ?? null,
  };
}

function snapshotHash(type: CollectionSyncType, members: object[]): string {
  const normalized = members
    .map((member) => comparable(type, member))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

function parseInput(type: CollectionSyncType, value: Record<string, unknown>) {
  return type === "SEMESTER_WEEK_COLLECTION"
    ? weekCollectionSchema.parse(value)
    : scheduleCollectionSchema.parse(value);
}

async function verifyParent(
  query: QueryPort,
  ownerId: string,
  type: CollectionSyncType,
  parentId: string,
  lock: boolean,
): Promise<Record<string, unknown>> {
  const table = type === "SEMESTER_WEEK_COLLECTION" ? "semesters" : "courses";
  const result = await query.query<{ value: Record<string, unknown> }>(
    `SELECT row_to_json(p) AS value FROM ${table} p WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL${lock ? " FOR UPDATE" : ""}`,
    [parentId, ownerId],
  );
  const parent = result.rows[0]?.value;
  if (!parent)
    throw new CloudError(
      "NOT_FOUND",
      404,
      type === "SEMESTER_WEEK_COLLECTION"
        ? "Semester not found"
        : "Course not found",
    );
  return parent;
}

async function fullCollection(
  query: QueryPort,
  ownerId: string,
  type: CollectionSyncType,
  parentId: string,
): Promise<object[]> {
  if (type === "SEMESTER_WEEK_COLLECTION") {
    const result = await query.query<{ value: SemesterWeek }>(
      "SELECT row_to_json(w) AS value FROM semester_weeks w WHERE owner_id=$1 AND semester_id=$2 ORDER BY week_number,id",
      [ownerId, parentId],
    );
    return result.rows.map((row) => row.value);
  }
  const result = await query.query<{ value: CourseSchedule }>(
    "SELECT row_to_json(s) AS value FROM course_schedules s WHERE owner_id=$1 AND course_id=$2 AND deleted_at IS NULL ORDER BY weekday,start_time,id",
    [ownerId, parentId],
  );
  return result.rows.map((row) => row.value);
}

async function revision(
  query: QueryPort,
  ownerId: string,
  type: CollectionSyncType,
  parentId: string,
  currentHash: string,
  lock: boolean,
): Promise<CollectionRevision> {
  await query.query(
    `INSERT INTO sync_collection_revisions
     (owner_id,collection_type,parent_id,collection_version,snapshot_hash,updated_at)
     VALUES ($1,$2,$3,0,$4,now()) ON CONFLICT DO NOTHING`,
    [ownerId, type, parentId, currentHash],
  );
  const result = await query.query<CollectionRevision>(
    `SELECT collection_version,snapshot_hash FROM sync_collection_revisions
     WHERE owner_id=$1 AND collection_type=$2 AND parent_id=$3${lock ? " FOR UPDATE" : ""}`,
    [ownerId, type, parentId],
  );
  const found = result.rows[0];
  if (!found)
    throw new CloudError("SERVER_ERROR", 500, "Collection revision missing");
  return {
    collection_version: Number(found.collection_version),
    snapshot_hash: found.snapshot_hash,
  };
}

function validateMembers(
  type: CollectionSyncType,
  parent: Record<string, unknown>,
  parentId: string,
  members: CollectionMember[],
) {
  const ids = new Set<string>();
  for (const member of members) {
    if (ids.has(member.id))
      throw new CloudError(
        "VALIDATION_ERROR",
        400,
        "Collection contains a duplicate object",
      );
    ids.add(member.id);
    if (
      (type === "SEMESTER_WEEK_COLLECTION" &&
        "semester_id" in member &&
        member.semester_id !== parentId) ||
      (type === "COURSE_SCHEDULE_COLLECTION" &&
        "course_id" in member &&
        member.course_id !== parentId)
    )
      throw new CloudError(
        "VALIDATION_ERROR",
        400,
        "Collection parent does not match",
      );
  }
  if (type === "SEMESTER_WEEK_COLLECTION") {
    const weeks = [...(members as WeekMember[])].sort((a, b) =>
      a.start_date.localeCompare(b.start_date),
    );
    const numbers = new Set<number>();
    for (let index = 0; index < weeks.length; index++) {
      const week = weeks[index]!;
      if (
        week.start_date > week.end_date ||
        week.start_date < String(parent.start_date) ||
        week.end_date > String(parent.end_date) ||
        numbers.has(week.week_number) ||
        (index > 0 && weeks[index - 1]!.end_date >= week.start_date)
      )
        throw new CloudError(
          "VALIDATION_ERROR",
          400,
          "Invalid semester week mapping",
        );
      numbers.add(week.week_number);
    }
  } else {
    for (const schedule of members as ScheduleMember[]) {
      // Both times or neither; when present, end must follow start.
      const timesValid =
        schedule.start_time === null && schedule.end_time === null
          ? true
          : schedule.start_time !== null &&
            schedule.end_time !== null &&
            time(schedule.start_time)! < time(schedule.end_time)!;
      if (
        !timesValid ||
        (schedule.week_start !== null &&
          schedule.week_end !== null &&
          schedule.week_start > schedule.week_end)
      )
        throw new CloudError(
          "VALIDATION_ERROR",
          400,
          "Invalid course schedule",
        );
    }
  }
}

async function applyCollection(
  query: QueryPort,
  ownerId: string,
  type: CollectionSyncType,
  parentId: string,
  members: CollectionMember[],
) {
  if (type === "SEMESTER_WEEK_COLLECTION") {
    for (const member of members as WeekMember[]) {
      const existing = await query.query<{
        owner_id: string;
        semester_id: string;
      }>("SELECT owner_id,semester_id FROM semester_weeks WHERE id=$1", [
        member.id,
      ]);
      if (existing.rows[0] && existing.rows[0].owner_id !== ownerId)
        throw new CloudError(
          "FORBIDDEN",
          403,
          "Semester week ID belongs to another account",
        );
      if (existing.rows[0] && existing.rows[0].semester_id !== parentId)
        throw new CloudError(
          "VALIDATION_ERROR",
          400,
          "Semester week ID belongs to another semester",
        );
    }
    await query.query(
      "DELETE FROM semester_weeks WHERE owner_id=$1 AND semester_id=$2",
      [ownerId, parentId],
    );
    for (const member of members as WeekMember[])
      await query.query(
        `INSERT INTO semester_weeks
         (id,owner_id,semester_id,week_number,start_date,end_date)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          member.id,
          ownerId,
          parentId,
          member.week_number,
          member.start_date,
          member.end_date,
        ],
      );
    return;
  }
  const schedules = members as ScheduleMember[];
  const ids = schedules.map((member) => member.id);
  if (ids.length)
    await query.query(
      `UPDATE course_schedules SET deleted_at=now(),updated_at=now(),row_version=row_version+1
       WHERE owner_id=$1 AND course_id=$2 AND deleted_at IS NULL AND NOT (id=ANY($3::uuid[]))`,
      [ownerId, parentId, ids],
    );
  else
    await query.query(
      `UPDATE course_schedules SET deleted_at=now(),updated_at=now(),row_version=row_version+1
       WHERE owner_id=$1 AND course_id=$2 AND deleted_at IS NULL`,
      [ownerId, parentId],
    );
  for (const member of schedules) {
    const existing = await query.query<{ owner_id: string; course_id: string }>(
      "SELECT owner_id,course_id FROM course_schedules WHERE id=$1 FOR UPDATE",
      [member.id],
    );
    if (existing.rows[0] && existing.rows[0].owner_id !== ownerId)
      throw new CloudError(
        "FORBIDDEN",
        403,
        "Schedule ID belongs to another account",
      );
    if (existing.rows[0] && existing.rows[0].course_id !== parentId)
      throw new CloudError(
        "VALIDATION_ERROR",
        400,
        "Schedule ID belongs to another course",
      );
    if (existing.rows[0])
      await query.query(
        `UPDATE course_schedules SET weekday=$3,start_time=$4,end_time=$5,week_start=$6,
         week_end=$7,classroom=$8,stage_label=$9,updated_at=$10,deleted_at=NULL,
         row_version=row_version+1 WHERE id=$1 AND owner_id=$2`,
        [
          member.id,
          ownerId,
          member.weekday,
          time(member.start_time),
          time(member.end_time),
          member.week_start,
          member.week_end,
          member.classroom,
          member.stage_label,
          member.updated_at,
        ],
      );
    else
      await query.query(
        `INSERT INTO course_schedules
         (id,owner_id,course_id,weekday,start_time,end_time,week_start,week_end,classroom,
          stage_label,created_at,updated_at,deleted_at,row_version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NULL,1)`,
        [
          member.id,
          ownerId,
          parentId,
          member.weekday,
          time(member.start_time),
          time(member.end_time),
          member.week_start,
          member.week_end,
          member.classroom,
          member.stage_label,
          member.created_at,
          member.updated_at,
        ],
      );
  }
}

async function writeEnvelope(
  query: QueryPort,
  ownerId: string,
  type: CollectionSyncType,
  parentId: string,
  members: object[],
  version: number,
) {
  await query.query(
    `INSERT INTO change_log
     (owner_id,entity_type,entity_id,operation,changed_fields,entity_version)
     VALUES ($1,$2,$3,'UPDATE',$4::jsonb,$5)`,
    [
      ownerId,
      type,
      parentId,
      JSON.stringify({ parent_id: parentId, collection: members }),
      version,
    ],
  );
}

/** Keep direct REST replacements in the same collection version/change stream. */
export async function recordExternalCollectionReplacement(
  query: QueryPort,
  ownerId: string,
  type: CollectionSyncType,
  parentId: string,
): Promise<number> {
  const collection = await fullCollection(query, ownerId, type, parentId);
  const hash = snapshotHash(type, collection);
  const current = await revision(query, ownerId, type, parentId, hash, true);
  const version = current.collection_version + 1;
  await query.query(
    `UPDATE sync_collection_revisions SET collection_version=$4,snapshot_hash=$5,updated_at=now()
     WHERE owner_id=$1 AND collection_type=$2 AND parent_id=$3`,
    [ownerId, type, parentId, version, hash],
  );
  await writeEnvelope(query, ownerId, type, parentId, collection, version);
  return version;
}

export async function currentCollectionDescriptor(
  query: QueryPort,
  ownerId: string,
  type: CollectionSyncType,
  parentId: string,
  lock = false,
) {
  await verifyParent(query, ownerId, type, parentId, lock);
  const collection = await fullCollection(query, ownerId, type, parentId);
  const current = await revision(
    query,
    ownerId,
    type,
    parentId,
    snapshotHash(type, collection),
    lock,
  );
  return {
    id: parentId,
    owner_id: ownerId,
    row_version: current.collection_version,
    collection,
  };
}

export async function resolveCollectionWithinTransaction(
  query: QueryPort,
  ownerId: string,
  type: CollectionSyncType,
  parentId: string,
  observedVersion: number,
  selected: "LOCAL" | "REMOTE",
  localCollection: unknown,
) {
  const parent = await verifyParent(query, ownerId, type, parentId, true);
  const before = await fullCollection(query, ownerId, type, parentId);
  const current = await revision(
    query,
    ownerId,
    type,
    parentId,
    snapshotHash(type, before),
    true,
  );
  if (current.collection_version !== observedVersion)
    throw new CloudError(
      "VERSION_CONFLICT",
      409,
      "Collection changed since review",
      { current_version: current.collection_version },
    );
  if (selected === "REMOTE")
    return {
      id: parentId,
      owner_id: ownerId,
      row_version: current.collection_version,
      collection: before,
    };
  const parsed = parseInput(type, {
    previous_collection: [],
    collection: localCollection,
  }).collection as CollectionMember[];
  validateMembers(type, parent, parentId, parsed);
  await applyCollection(query, ownerId, type, parentId, parsed);
  const after = await fullCollection(query, ownerId, type, parentId);
  const version = current.collection_version + 1;
  await query.query(
    `UPDATE sync_collection_revisions SET collection_version=$4,snapshot_hash=$5,updated_at=now()
     WHERE owner_id=$1 AND collection_type=$2 AND parent_id=$3`,
    [ownerId, type, parentId, version, snapshotHash(type, after)],
  );
  await writeEnvelope(query, ownerId, type, parentId, after, version);
  return {
    id: parentId,
    owner_id: ownerId,
    row_version: version,
    collection: after,
  };
}

export class CloudCollectionSync {
  constructor(private readonly db: CloudDatabase) {}

  async replace(
    ownerId: string,
    mutation: CollectionMutationInput,
  ): Promise<CollectionPushResult> {
    if (mutation.operation !== "UPDATE" || mutation.base_version === null)
      throw new CloudError(
        "VALIDATION_ERROR",
        400,
        "Collection replacement needs an expected version",
      );
    if (
      !Number.isSafeInteger(mutation.base_version) ||
      mutation.base_version < 0
    )
      throw new CloudError(
        "VALIDATION_ERROR",
        400,
        "Invalid collection version",
      );
    const input = parseInput(mutation.entity_type, mutation.changed_fields);
    const requestHash = createHash("sha256")
      .update(JSON.stringify(mutation))
      .digest("hex");
    return this.db.transaction(async (query) => {
      const prior = await query.query<IdempotencyRow>(
        "SELECT request_hash,response FROM idempotency_keys WHERE owner_id=$1 AND mutation_id=$2",
        [ownerId, mutation.mutation_id],
      );
      if (prior.rows[0]) {
        if (prior.rows[0].request_hash !== requestHash)
          throw new CloudError(
            "IDEMPOTENCY_REPLAY",
            409,
            "Mutation ID was used for different data",
          );
        return prior.rows[0].response;
      }
      const parent = await verifyParent(
        query,
        ownerId,
        mutation.entity_type,
        mutation.entity_id,
        true,
      );
      const previous = input.previous_collection as CollectionMember[];
      const desired = input.collection as CollectionMember[];
      validateMembers(
        mutation.entity_type,
        parent,
        mutation.entity_id,
        desired,
      );
      const live = await fullCollection(
        query,
        ownerId,
        mutation.entity_type,
        mutation.entity_id,
      );
      const liveHash = snapshotHash(mutation.entity_type, live);
      const current = await revision(
        query,
        ownerId,
        mutation.entity_type,
        mutation.entity_id,
        liveHash,
        true,
      );
      let response: CollectionPushResult;
      if (
        mutation.base_version !== current.collection_version ||
        snapshotHash(mutation.entity_type, previous) !== liveHash ||
        current.snapshot_hash !== liveHash
      ) {
        const conflictId = randomUUID();
        await query.query(
          `INSERT INTO sync_conflicts
           (id,owner_id,entity_type,entity_id,local_version,remote_version,
            conflicting_fields,status,created_at)
           VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,'["collection"]'::jsonb,'OPEN',now())`,
          [
            conflictId,
            ownerId,
            mutation.entity_type,
            mutation.entity_id,
            JSON.stringify({
              base_version: mutation.base_version,
              previous_collection: previous,
              collection: desired,
            }),
            JSON.stringify({
              row_version: current.collection_version,
              collection: live,
            }),
          ],
        );
        response = {
          mutation_id: mutation.mutation_id,
          result: "CONFLICT",
          conflict_id: conflictId,
        };
      } else {
        await applyCollection(
          query,
          ownerId,
          mutation.entity_type,
          mutation.entity_id,
          desired,
        );
        const after = await fullCollection(
          query,
          ownerId,
          mutation.entity_type,
          mutation.entity_id,
        );
        const version = current.collection_version + 1;
        await query.query(
          `UPDATE sync_collection_revisions SET collection_version=$4,snapshot_hash=$5,updated_at=now()
           WHERE owner_id=$1 AND collection_type=$2 AND parent_id=$3`,
          [
            ownerId,
            mutation.entity_type,
            mutation.entity_id,
            version,
            snapshotHash(mutation.entity_type, after),
          ],
        );
        await writeEnvelope(
          query,
          ownerId,
          mutation.entity_type,
          mutation.entity_id,
          after,
          version,
        );
        response = {
          mutation_id: mutation.mutation_id,
          result: "ACK",
          entity_version: version,
        };
      }
      await query.query(
        "INSERT INTO idempotency_keys (owner_id,mutation_id,request_hash,response) VALUES ($1,$2,$3,$4::jsonb)",
        [ownerId, mutation.mutation_id, requestHash, JSON.stringify(response)],
      );
      return response;
    });
  }
}
