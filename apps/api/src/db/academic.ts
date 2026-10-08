import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { dateOnlySchema } from "@daymark/contracts";
import type { CourseSchedule, Semester, SemesterWeek } from "@daymark/domain";
import { CloudError, type CloudDatabase, type QueryPort } from "./cloud.js";
import { recordExternalCollectionReplacement } from "./collections.js";

export const semesterInputSchema = z.object({
  name: z.string().trim().min(1),
  start_date: dateOnlySchema,
  end_date: dateOnlySchema,
});

export const semesterPatchSchema = semesterInputSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0);

export const weekInputSchema = z.object({
  week_number: z.number().int().positive(),
  start_date: dateOnlySchema,
  end_date: dateOnlySchema,
});

// null = no clock time stated in the source (periods only). The both-or-
// neither and end>start rules stay in replaceSchedules so a violation
// surfaces as the usual 400 VALIDATION_ERROR instead of a thrown ZodError.
export const scheduleInputSchema = z.object({
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
});

type SemesterInput = z.infer<typeof semesterInputSchema>;
type WeekInput = z.infer<typeof weekInputSchema>;
type ScheduleInput = z.infer<typeof scheduleInputSchema>;

function validDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

async function log(
  q: QueryPort,
  ownerId: string,
  type: string,
  id: string,
  operation: string,
  fields: object,
  version: number,
) {
  await q.query(
    "INSERT INTO change_log (owner_id,entity_type,entity_id,operation,changed_fields,entity_version) VALUES ($1,$2,$3,$4,$5::jsonb,$6)",
    [ownerId, type, id, operation, JSON.stringify(fields), version],
  );
}

/** Canonical academic facts shared by REST and the sync change stream. */
export class CloudAcademicManager {
  constructor(private readonly db: CloudDatabase) {}

  private async idempotent<T extends object>(
    ownerId: string,
    key: string,
    operation: string,
    body: object,
    work: (q: QueryPort) => Promise<T>,
  ): Promise<T> {
    const hash = createHash("sha256")
      .update(JSON.stringify({ operation, body }))
      .digest("hex");
    const lookup = async (q: QueryPort): Promise<T | null> => {
      const prior = await q.query<{ request_hash: string; response: T }>(
        "SELECT request_hash,response FROM idempotency_keys WHERE owner_id=$1 AND mutation_id=$2",
        [ownerId, key],
      );
      if (!prior.rows[0]) return null;
      if (prior.rows[0].request_hash !== hash)
        throw new CloudError(
          "IDEMPOTENCY_REPLAY",
          409,
          "Idempotency key was used for different data",
        );
      return prior.rows[0].response;
    };
    try {
      return await this.db.transaction(async (q) => {
        const prior = await lookup(q);
        if (prior) return prior;
        const result = await work(q);
        await q.query(
          "INSERT INTO idempotency_keys (owner_id,mutation_id,request_hash,response) VALUES ($1,$2,$3,$4::jsonb)",
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
        const prior = await lookup(this.db);
        if (prior) return prior;
      }
      throw error;
    }
  }

  async semester(ownerId: string, id: string): Promise<Semester | null> {
    const result = await this.db.query<{ value: Semester }>(
      "SELECT row_to_json(s) AS value FROM semesters s WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL",
      [id, ownerId],
    );
    return result.rows[0]?.value ?? null;
  }

  async semesters(ownerId: string): Promise<Semester[]> {
    const result = await this.db.query<{ value: Semester }>(
      "SELECT row_to_json(s) AS value FROM semesters s WHERE owner_id=$1 AND deleted_at IS NULL ORDER BY start_date DESC,id DESC",
      [ownerId],
    );
    return result.rows.map((row) => row.value);
  }

  async createSemester(
    ownerId: string,
    key: string,
    input: SemesterInput,
  ): Promise<Semester> {
    if (
      !validDate(input.start_date) ||
      !validDate(input.end_date) ||
      input.start_date > input.end_date
    )
      throw new CloudError("VALIDATION_ERROR", 400, "Invalid semester dates");
    return this.idempotent(
      ownerId,
      key,
      "semester:create",
      input,
      async (q) => {
        const id = randomUUID();
        const result = await q.query<{ value: Semester }>(
          `WITH inserted AS (INSERT INTO semesters (id,owner_id,name,start_date,end_date,created_at,updated_at,deleted_at,row_version)
         VALUES ($1,$2,$3,$4,$5,now(),now(),NULL,1) RETURNING *) SELECT row_to_json(inserted) AS value FROM inserted`,
          [id, ownerId, input.name, input.start_date, input.end_date],
        );
        const value = result.rows[0]!.value;
        await log(q, ownerId, "SEMESTER", id, "CREATE", value, 1);
        return value;
      },
    );
  }

  async updateSemester(
    ownerId: string,
    id: string,
    key: string,
    baseVersion: number,
    input: z.infer<typeof semesterPatchSchema>,
  ): Promise<Semester> {
    return this.idempotent(
      ownerId,
      key,
      `semester:update:${id}:${baseVersion}`,
      input,
      async (q) => {
        const existing = await q.query<{ value: Semester }>(
          "SELECT row_to_json(s) AS value FROM semesters s WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL FOR UPDATE",
          [id, ownerId],
        );
        const current = existing.rows[0]?.value;
        if (!current)
          throw new CloudError("NOT_FOUND", 404, "Semester not found");
        if (Number(current.row_version) !== baseVersion)
          throw new CloudError(
            "VERSION_CONFLICT",
            409,
            "Semester changed on another device",
          );
        const next = {
          ...current,
          name: input.name ?? current.name,
          start_date: input.start_date ?? current.start_date,
          end_date: input.end_date ?? current.end_date,
        };
        if (
          !validDate(next.start_date) ||
          !validDate(next.end_date) ||
          next.start_date > next.end_date
        )
          throw new CloudError(
            "VALIDATION_ERROR",
            400,
            "Invalid semester dates",
          );
        const result = await q.query<{ value: Semester }>(
          `WITH changed AS (UPDATE semesters SET name=$3,start_date=$4,end_date=$5,updated_at=now(),row_version=row_version+1
         WHERE id=$1 AND owner_id=$2 RETURNING *) SELECT row_to_json(changed) AS value FROM changed`,
          [id, ownerId, next.name, next.start_date, next.end_date],
        );
        const value = result.rows[0]!.value;
        await log(
          q,
          ownerId,
          "SEMESTER",
          id,
          "UPDATE",
          input,
          Number(value.row_version),
        );
        return value;
      },
    );
  }

  async weeks(ownerId: string, semesterId: string): Promise<SemesterWeek[]> {
    if (!(await this.semester(ownerId, semesterId)))
      throw new CloudError("NOT_FOUND", 404, "Semester not found");
    const result = await this.db.query<{ value: SemesterWeek }>(
      "SELECT row_to_json(w) AS value FROM semester_weeks w WHERE owner_id=$1 AND semester_id=$2 ORDER BY week_number",
      [ownerId, semesterId],
    );
    return result.rows.map((row) => row.value);
  }

  async replaceWeeks(
    ownerId: string,
    semesterId: string,
    key: string,
    weeks: WeekInput[],
  ): Promise<SemesterWeek[]> {
    return this.idempotent(
      ownerId,
      key,
      `weeks:replace:${semesterId}`,
      { weeks },
      async (q) => {
        const semesterRow = await q.query<{ value: Semester }>(
          "SELECT row_to_json(s) AS value FROM semesters s WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL FOR UPDATE",
          [semesterId, ownerId],
        );
        const semester = semesterRow.rows[0]?.value;
        if (!semester)
          throw new CloudError("NOT_FOUND", 404, "Semester not found");
        const sorted = [...weeks].sort((a, b) =>
          a.start_date.localeCompare(b.start_date),
        );
        const numbers = new Set<number>();
        for (let i = 0; i < sorted.length; i++) {
          const week = sorted[i]!;
          if (
            !validDate(week.start_date) ||
            !validDate(week.end_date) ||
            week.start_date > week.end_date ||
            week.start_date < semester.start_date ||
            week.end_date > semester.end_date ||
            numbers.has(week.week_number) ||
            (i > 0 && sorted[i - 1]!.end_date >= week.start_date)
          )
            throw new CloudError(
              "VALIDATION_ERROR",
              400,
              "Invalid semester week mapping",
            );
          numbers.add(week.week_number);
        }
        await q.query(
          "DELETE FROM semester_weeks WHERE owner_id=$1 AND semester_id=$2 RETURNING id,semester_id",
          [ownerId, semesterId],
        );
        const created: SemesterWeek[] = [];
        for (const week of sorted) {
          const id = randomUUID();
          const inserted = await q.query<{ value: SemesterWeek }>(
            `WITH inserted AS (INSERT INTO semester_weeks (id,owner_id,semester_id,week_number,start_date,end_date)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING *) SELECT row_to_json(inserted) AS value FROM inserted`,
            [
              id,
              ownerId,
              semesterId,
              week.week_number,
              week.start_date,
              week.end_date,
            ],
          );
          const value = inserted.rows[0]!.value;
          created.push(value);
        }
        await recordExternalCollectionReplacement(
          q,
          ownerId,
          "SEMESTER_WEEK_COLLECTION",
          semesterId,
        );
        return created;
      },
    );
  }

  async schedules(
    ownerId: string,
    courseId: string,
  ): Promise<CourseSchedule[]> {
    const course = await this.db.query<{ id: string }>(
      "SELECT id FROM courses WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL",
      [courseId, ownerId],
    );
    if (!course.rows[0])
      throw new CloudError("NOT_FOUND", 404, "Course not found");
    const result = await this.db.query<{ value: CourseSchedule }>(
      "SELECT row_to_json(s) AS value FROM course_schedules s WHERE owner_id=$1 AND course_id=$2 AND deleted_at IS NULL ORDER BY weekday,start_time,id",
      [ownerId, courseId],
    );
    return result.rows.map((row) => row.value);
  }

  async replaceSchedules(
    ownerId: string,
    courseId: string,
    key: string,
    schedules: ScheduleInput[],
  ): Promise<CourseSchedule[]> {
    return this.idempotent(
      ownerId,
      key,
      `schedules:replace:${courseId}`,
      { schedules },
      async (q) => {
        const course = await q.query<{ id: string }>(
          "SELECT id FROM courses WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL FOR UPDATE",
          [courseId, ownerId],
        );
        if (!course.rows[0])
          throw new CloudError("NOT_FOUND", 404, "Course not found");
        for (const value of schedules) {
          // Both times or neither; when present, end must follow start.
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
        }
        await q.query(
          `WITH changed AS (UPDATE course_schedules SET deleted_at=now(),updated_at=now(),row_version=row_version+1
         WHERE owner_id=$1 AND course_id=$2 AND deleted_at IS NULL RETURNING *) SELECT row_to_json(changed) AS value FROM changed`,
          [ownerId, courseId],
        );
        const created: CourseSchedule[] = [];
        for (const schedule of schedules) {
          const id = randomUUID();
          const result = await q.query<{ value: CourseSchedule }>(
            `WITH inserted AS (INSERT INTO course_schedules
           (id,owner_id,course_id,weekday,start_time,end_time,week_start,week_end,classroom,stage_label,created_at,updated_at,deleted_at,row_version)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now(),now(),NULL,1) RETURNING *)
           SELECT row_to_json(inserted) AS value FROM inserted`,
            [
              id,
              ownerId,
              courseId,
              schedule.weekday,
              schedule.start_time,
              schedule.end_time,
              schedule.week_start,
              schedule.week_end,
              schedule.classroom,
              schedule.stage_label,
            ],
          );
          const value = result.rows[0]!.value;
          created.push(value);
        }
        await recordExternalCollectionReplacement(
          q,
          ownerId,
          "COURSE_SCHEDULE_COLLECTION",
          courseId,
        );
        return created;
      },
    );
  }
}
