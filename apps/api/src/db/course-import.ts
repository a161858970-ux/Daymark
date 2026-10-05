import { createHash, randomUUID } from "node:crypto";
import {
  courseImportParseResultSchema,
  type CourseImportCandidate,
  type CourseImportCommitResult,
  type CourseImportDuplicateCandidate,
  type CourseImportJob,
  type CourseImportPreviewCourse,
  type CourseImportResolution,
  type CourseImportSourceType,
} from "@course-manager/contracts";
import type { CourseInformation, Semester } from "@course-manager/domain";
import { ZodError } from "zod";
import { ProviderError } from "../ai/chat-provider.js";
import { CourseImportParseError } from "../ai/pdf-source.js";
import { recordExternalCollectionReplacement } from "./collections.js";
import { CloudError, type CloudDatabase, type QueryPort } from "./cloud.js";
import type { RateLimiter } from "../rateLimit.js";

const MAX_IMPORT_BYTES = 15 * 1024 * 1024;

/** Kind of the file being uploaded now; null = unsupported media type. */
function courseImportSourceType(
  mediaType: string,
): CourseImportSourceType | null {
  if (mediaType === "application/pdf") return "PDF";
  if (mediaType.startsWith("image/")) return "IMAGE";
  return null;
}

export interface CourseImportParser {
  /**
   * Identity of the prompt/schema/model generation this parser belongs to;
   * keys the parse cache so a change re-parses instead of serving a stale
   * answer. Absent = caching off (test doubles, custom parsers).
   */
  readonly fingerprint?: string;
  parse(input: {
    sourceType: CourseImportSourceType;
    fileName: string;
    mediaType: string;
    contentBase64: string;
  }): Promise<unknown>;
}

interface StoredPreviewCourse extends CourseImportCandidate {
  duplicate_candidates: CourseImportDuplicateCandidate[];
}

interface ImportJobRow {
  id: string;
  owner_id: string;
  semester_id: string;
  source_type: CourseImportSourceType;
  status: CourseImportJob["status"];
  source_name: string | null;
  source_media_type: string | null;
  source_sha256: string | null;
  preview: StoredPreviewCourse[] | null;
  resolutions: Record<string, CourseImportResolution>;
  error_message: string | null;
  commit_result: CourseImportCommitResult | null;
  created_at: string;
  updated_at: string;
  committed_at: string | null;
}

function normalizeJson<T>(value: T | string | null, fallback: T): T {
  if (value === null) return fallback;
  return typeof value === "string" ? (JSON.parse(value) as T) : value;
}

function normalizeJob(row: ImportJobRow): ImportJobRow {
  return {
    ...row,
    preview: normalizeJson(row.preview, null),
    resolutions: normalizeJson(row.resolutions, {}),
    commit_result: normalizeJson(row.commit_result, null),
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
    committed_at: row.committed_at
      ? new Date(row.committed_at).toISOString()
      : null,
  };
}

function publicJob(row: ImportJobRow): CourseImportJob {
  const normalized = normalizeJob(row);
  const courses: CourseImportPreviewCourse[] = (normalized.preview ?? []).map(
    (course) => ({
      ...course,
      resolution: normalized.resolutions[course.name] ?? null,
    }),
  );
  return {
    id: normalized.id,
    semester_id: normalized.semester_id,
    source_type: normalized.source_type,
    status: normalized.status,
    source_name: normalized.source_name,
    courses,
    error_message: normalized.error_message,
    result: normalized.commit_result,
    created_at: normalized.created_at,
    updated_at: normalized.updated_at,
    committed_at: normalized.committed_at,
  };
}

function decodeBase64(value: string): Buffer {
  const compact = value.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact) || compact.length % 4 !== 0) {
    // Engineering detail for the API log only (never the payload): which
    // check rejected the upload, and how big it was.
    console.error(
      `[IMPORT_SOURCE] rejected: base64Length=${compact.length} ` +
        `multipleOfFour=${compact.length % 4 === 0} ` +
        `base64Charset=${/^[A-Za-z0-9+/=]*$/.test(compact)}`,
    );
    throw new CloudError("VALIDATION_ERROR", 400, "Invalid import source");
  }
  const bytes = Buffer.from(compact, "base64");
  if (!bytes.length || bytes.length > MAX_IMPORT_BYTES) {
    console.error(
      `[IMPORT_SOURCE] rejected: decodedBytes=${bytes.length} ` +
        `limit=${MAX_IMPORT_BYTES}`,
    );
    throw new CloudError(
      "VALIDATION_ERROR",
      400,
      "Import source must be between 1 byte and 15 MB",
    );
  }
  if (
    bytes.toString("base64").replace(/=+$/u, "") !== compact.replace(/=+$/u, "")
  ) {
    console.error(
      `[IMPORT_SOURCE] rejected: round-trip mismatch base64Length=${compact.length}`,
    );
    throw new CloudError("VALIDATION_ERROR", 400, "Invalid import source");
  }
  return bytes;
}

async function findJob(
  query: QueryPort,
  ownerId: string,
  id: string,
  lock = false,
): Promise<ImportJobRow | null> {
  const result = await query.query<{ value: ImportJobRow }>(
    `SELECT row_to_json(j) AS value FROM course_import_jobs j
     WHERE id=$1 AND owner_id=$2${lock ? " FOR UPDATE" : ""}`,
    [id, ownerId],
  );
  return result.rows[0]?.value ? normalizeJob(result.rows[0].value) : null;
}

async function logEntity(
  query: QueryPort,
  ownerId: string,
  entityType: string,
  entityId: string,
  fields: object,
) {
  await query.query(
    `INSERT INTO change_log
     (owner_id,entity_type,entity_id,operation,changed_fields,entity_version)
     VALUES ($1,$2,$3,'CREATE',$4::jsonb,1)`,
    [ownerId, entityType, entityId, JSON.stringify(fields)],
  );
}

/**
 * Failures stay inside the recoverable import job and are reported in product
 * language: engineering causes (status codes, provider kinds, stack traces)
 * never reach the user.
 */
export function importFailureMessage(cause: unknown): string {
  if (cause instanceof CourseImportParseError) return cause.userMessage;
  // The model answered but its payload broke a structural rule (e.g. a
  // schedule whose end precedes its start): the file was fine, so do not
  // blame its clarity — this is the case a retry is meant to fix.
  if (cause instanceof ZodError)
    return "识别结果未能通过校验，请重试一次；若仍失败，再换更清晰的文件。";
  if (cause instanceof ProviderError) {
    if (cause.kind === "AUTH" || cause.kind === "INVALID_REQUEST")
      return "智能整理暂时无法使用，请检查服务配置后重试。";
    if (cause.kind === "MALFORMED")
      return "无法可靠识别该课程表，请重新上传清晰文件。";
    if (cause.kind === "TRUNCATED")
      return "课程表内容过长，无法一次识别，请拆分后重试。";
    if (cause.kind === "TIMEOUT")
      return "识别服务响应超时，文件已保留，请稍后再试。";
    return "智能整理暂时不可用，文件已保留，请稍后重试。";
  }
  return "无法可靠识别该课程表，请重新上传清晰文件。";
}

export class CloudCourseImportManager {
  constructor(
    private readonly db: CloudDatabase,
    private readonly parser: CourseImportParser | null,
    /** AI quota for source parsing; charged only when a parser is configured. */
    private readonly limiter: RateLimiter | null = null,
  ) {}

  async start(
    ownerId: string,
    semesterId: string,
    sourceType: CourseImportSourceType,
  ): Promise<CourseImportJob> {
    const semester = await this.db.query<{ id: string }>(
      "SELECT id FROM semesters WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL",
      [semesterId, ownerId],
    );
    if (!semester.rows[0])
      throw new CloudError("NOT_FOUND", 404, "Semester not found");
    const id = randomUUID();
    const result = await this.db.query<{ value: ImportJobRow }>(
      `WITH inserted AS (
         INSERT INTO course_import_jobs
         (id,owner_id,semester_id,source_type,status)
         VALUES ($1,$2,$3,$4,'AWAITING_SOURCE') RETURNING *
       ) SELECT row_to_json(inserted) AS value FROM inserted`,
      [id, ownerId, semesterId, sourceType],
    );
    return publicJob(result.rows[0]!.value);
  }

  async listPending(
    ownerId: string,
    semesterId?: string,
  ): Promise<CourseImportJob[]> {
    const result = await this.db.query<{ value: ImportJobRow }>(
      `SELECT row_to_json(j) AS value FROM course_import_jobs j
       WHERE owner_id=$1 AND status <> 'COMMITTED'
         AND ($2::uuid IS NULL OR semester_id=$2)
       ORDER BY updated_at DESC,id DESC`,
      [ownerId, semesterId ?? null],
    );
    return result.rows.map((row) => publicJob(row.value));
  }

  async get(ownerId: string, id: string): Promise<CourseImportJob> {
    const row = await findJob(this.db, ownerId, id);
    if (!row) throw new CloudError("NOT_FOUND", 404, "Course import not found");
    return publicJob(row);
  }

  /**
   * Discards a recognition result the user chose not to write.
   *
   * The row is deleted rather than flagged: listPending returns every job
   * that is not COMMITTED, so only clearing the panel would bring the same
   * preview back on the next page load. A committed result is refused — the
   * courses already exist and must be removed from the course list instead.
   */
  async discard(ownerId: string, id: string): Promise<void> {
    await this.db.transaction(async (query) => {
      const job = await findJob(query, ownerId, id, true);
      if (!job)
        throw new CloudError("NOT_FOUND", 404, "Course import not found");
      if (job.status === "COMMITTED")
        throw new CloudError(
          "VALIDATION_ERROR",
          409,
          "Course import is already committed",
        );
      await query.query(
        "DELETE FROM course_import_jobs WHERE id=$1 AND owner_id=$2",
        [id, ownerId],
      );
    });
  }

  async parseSource(
    ownerId: string,
    id: string,
    source: {
      file_name: string;
      media_type: string;
      content_base64: string;
    },
  ): Promise<CourseImportJob> {
    const current = await findJob(this.db, ownerId, id);
    if (!current)
      throw new CloudError("NOT_FOUND", 404, "Course import not found");
    if (current.status === "COMMITTED")
      throw new CloudError(
        "VALIDATION_ERROR",
        409,
        "Course import is already committed",
      );
    // The type comes from the file the user picked now, not from the type
    // the job was created with: the panel offers "重新选择课程表文件" on a
    // pending job, so switching image -> PDF must work. Matching against the
    // stored type rejected that with an English message that errors.ts
    // translated into the oversized-file copy, hiding the real cause.
    const uploadedType = courseImportSourceType(source.media_type);
    if (!uploadedType)
      throw new CloudError("VALIDATION_ERROR", 400, "只支持 PDF 和图片文件。");
    const bytes = decodeBase64(source.content_base64);
    if (!this.parser)
      throw new CloudError(
        "IMPORT_FAILED",
        503,
        "Course import parser is unavailable",
      );

    let parsed: ReturnType<typeof courseImportParseResultSchema.parse>;
    const sourceHash = createHash("sha256").update(bytes).digest("hex");
    const promptVersion = this.parser.fingerprint ?? null;
    // Same bytes + same prompt/model generation already produced an answer
    // once (retry after a timeout, a second import of the same export):
    // serve it without another provider call. A corrupt or missing row is a
    // miss, never an error — caching only ever makes the path faster.
    let cached: ReturnType<typeof courseImportParseResultSchema.parse> | null =
      null;
    if (promptVersion) {
      try {
        const row = await this.db.query<{ result: unknown }>(
          `SELECT result FROM course_import_parse_cache
           WHERE owner_id=$1 AND source_sha256=$2 AND prompt_version=$3`,
          [ownerId, sourceHash, promptVersion],
        );
        if (row.rows[0])
          cached = courseImportParseResultSchema.parse(row.rows[0].result);
      } catch {
        cached = null;
      }
    }
    if (!cached) {
      const gate = this.limiter?.check(`owner:${ownerId}`);
      if (gate && !gate.allowed)
        throw new CloudError(
          "RATE_LIMITED",
          429,
          "请求过于频繁，请稍后再试。",
          {
            retry_after_seconds: gate.retryAfterSeconds,
          },
        );
    }
    try {
      // A schema rejection means the model produced malformed data (one real
      // case: a schedule whose end preceded its start). One fresh model round
      // usually fixes it; only a second failure fails the job, and unreadable
      // sources or provider errors are not retried here.
      if (cached) {
        parsed = cached;
      } else {
        for (let attempt = 0; ; attempt++) {
          try {
            const raw: unknown = await this.parser.parse({
              sourceType: uploadedType,
              fileName: source.file_name,
              mediaType: source.media_type,
              contentBase64: bytes.toString("base64"),
            });
            // The file was readable and the model answered, but it found no
            // course at all: report that instead of the misleading "file not
            // clear" copy that only fits an unreadable source.
            const courses = (raw as { courses?: unknown } | null)?.courses;
            if (Array.isArray(courses) && courses.length === 0)
              throw new CourseImportParseError(
                "NO_COURSES",
                "未从该文件中识别出课程。请确认这是本学期的课程表且内容清晰，也可以改用清晰截图重新导入。",
              );
            parsed = courseImportParseResultSchema.parse(raw);
            break;
          } catch (error) {
            if (error instanceof ZodError && attempt === 0) continue;
            throw error;
          }
        }
        if (promptVersion)
          try {
            await this.db.query(
              `INSERT INTO course_import_parse_cache
                 (owner_id,source_sha256,prompt_version,result)
               VALUES($1,$2,$3,$4::jsonb) ON CONFLICT DO NOTHING`,
              [ownerId, sourceHash, promptVersion, JSON.stringify(parsed)],
            );
          } catch {
            // Best-effort: a cache hiccup must not fail a finished parse.
          }
      }
    } catch (error) {
      const message = importFailureMessage(error);
      await this.db.query(
        `UPDATE course_import_jobs SET status='FAILED',error_message=$3,
         source_name=$4,source_media_type=$5,source_type=$6,updated_at=now()
         WHERE id=$1 AND owner_id=$2 AND status <> 'COMMITTED'`,
        [
          id,
          ownerId,
          message,
          source.file_name,
          source.media_type,
          uploadedType,
        ],
      );
      throw new CloudError("IMPORT_FAILED", 422, message, {}, { cause: error });
    }

    return this.db.transaction(async (query) => {
      const job = await findJob(query, ownerId, id, true);
      if (!job)
        throw new CloudError("NOT_FOUND", 404, "Course import not found");
      if (job.status === "COMMITTED") return publicJob(job);
      const semesterResult = await query.query<{ value: Semester }>(
        `SELECT row_to_json(s) AS value FROM semesters s
         WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL FOR UPDATE`,
        [job.semester_id, ownerId],
      );
      const semester = semesterResult.rows[0]?.value;
      if (!semester)
        throw new CloudError("NOT_FOUND", 404, "Semester not found");
      const previous = await query.query<{ id: string }>(
        `SELECT id FROM semesters WHERE owner_id=$1 AND deleted_at IS NULL
         AND end_date < $2 ORDER BY end_date DESC,start_date DESC,id DESC LIMIT 1`,
        [ownerId, semester.start_date],
      );
      const previousId = previous.rows[0]?.id ?? null;
      const matches = previousId
        ? await query.query<CourseImportDuplicateCandidate>(
            `SELECT id,name,semester_id FROM courses
             WHERE owner_id=$1 AND semester_id=$2 AND deleted_at IS NULL
               AND name=ANY($3::text[]) ORDER BY name,id`,
            [ownerId, previousId, parsed.courses.map((course) => course.name)],
          )
        : { rows: [] as CourseImportDuplicateCandidate[] };
      const preview: StoredPreviewCourse[] = parsed.courses.map((course) => ({
        ...course,
        duplicate_candidates: matches.rows.filter(
          (candidate) => candidate.name === course.name,
        ),
      }));
      const needsResolution = preview.some(
        (course) => course.duplicate_candidates.length > 0,
      );
      const updated = await query.query<{ value: ImportJobRow }>(
        `WITH changed AS (
           UPDATE course_import_jobs SET source_name=$3,source_media_type=$4,
             source_sha256=$5,preview=$6::jsonb,resolutions='{}'::jsonb,
             status=$7,source_type=$8,error_message=NULL,commit_result=NULL,
             committed_at=NULL,updated_at=now()
             WHERE id=$1 AND owner_id=$2 RETURNING *
         ) SELECT row_to_json(changed) AS value FROM changed`,
        [
          id,
          ownerId,
          source.file_name,
          source.media_type,
          sourceHash,
          JSON.stringify(preview),
          needsResolution ? "NEEDS_RESOLUTION" : "READY",
          uploadedType,
        ],
      );
      return publicJob(updated.rows[0]!.value);
    });
  }

  async resolveCourse(
    ownerId: string,
    id: string,
    resolution: CourseImportResolution,
  ): Promise<CourseImportJob> {
    return this.db.transaction(async (query) => {
      const job = await findJob(query, ownerId, id, true);
      if (!job)
        throw new CloudError("NOT_FOUND", 404, "Course import not found");
      if (!job.preview || job.status === "AWAITING_SOURCE")
        throw new CloudError(
          "VALIDATION_ERROR",
          409,
          "Course import has no preview",
        );
      if (job.status === "COMMITTED")
        throw new CloudError(
          "VALIDATION_ERROR",
          409,
          "Course import is already committed",
        );
      const course = job.preview.find(
        (value) => value.name === resolution.incoming_course_name,
      );
      if (!course)
        throw new CloudError(
          "VALIDATION_ERROR",
          400,
          "Imported course was not found",
        );
      if (!course.duplicate_candidates.length)
        throw new CloudError(
          "VALIDATION_ERROR",
          400,
          "Imported course has no duplicate candidate",
        );
      if (
        resolution.decision === "SAME_COURSE" &&
        !course.duplicate_candidates.some(
          (candidate) => candidate.id === resolution.existing_course_id,
        )
      )
        throw new CloudError(
          "VALIDATION_ERROR",
          400,
          "Selected Course is not an exact-name candidate",
        );
      const resolutions = {
        ...job.resolutions,
        [course.name]: resolution,
      };
      const ready = job.preview.every(
        (value) =>
          value.duplicate_candidates.length === 0 ||
          Boolean(resolutions[value.name]),
      );
      const updated = await query.query<{ value: ImportJobRow }>(
        `WITH changed AS (
           UPDATE course_import_jobs SET resolutions=$3::jsonb,status=$4,
             error_message=NULL,updated_at=now()
           WHERE id=$1 AND owner_id=$2 RETURNING *
         ) SELECT row_to_json(changed) AS value FROM changed`,
        [
          id,
          ownerId,
          JSON.stringify(resolutions),
          ready ? "READY" : "NEEDS_RESOLUTION",
        ],
      );
      return publicJob(updated.rows[0]!.value);
    });
  }

  async commit(
    ownerId: string,
    id: string,
    idempotencyKey: string,
  ): Promise<CourseImportCommitResult> {
    const operation = `course-import:commit:${id}`;
    const requestHash = createHash("sha256")
      .update(JSON.stringify({ operation, id }))
      .digest("hex");
    const lookup = async (query: QueryPort) => {
      const prior = await query.query<{
        request_hash: string;
        response: CourseImportCommitResult;
      }>(
        "SELECT request_hash,response FROM idempotency_keys WHERE owner_id=$1 AND mutation_id=$2",
        [ownerId, idempotencyKey],
      );
      const row = prior.rows[0];
      if (!row) return null;
      if (row.request_hash !== requestHash)
        throw new CloudError(
          "IDEMPOTENCY_REPLAY",
          409,
          "Idempotency key was used for different data",
        );
      return normalizeJson(row.response, null as never);
    };

    const work = async (): Promise<CourseImportCommitResult> =>
      this.db.transaction(async (query) => {
        const prior = await lookup(query);
        if (prior) return prior;
        const job = await findJob(query, ownerId, id, true);
        if (!job)
          throw new CloudError("NOT_FOUND", 404, "Course import not found");
        if (job.status === "COMMITTED" && job.commit_result) {
          await query.query(
            "INSERT INTO idempotency_keys (owner_id,mutation_id,request_hash,response) VALUES ($1,$2,$3,$4::jsonb)",
            [
              ownerId,
              idempotencyKey,
              requestHash,
              JSON.stringify(job.commit_result),
            ],
          );
          return job.commit_result;
        }
        if (job.status !== "READY" || !job.preview || !job.source_sha256)
          throw new CloudError(
            "VALIDATION_ERROR",
            409,
            "Course import still needs review",
          );

        const priorSource = await query.query<{
          result: CourseImportCommitResult;
        }>(
          `SELECT result FROM course_import_commits
           WHERE owner_id=$1 AND semester_id=$2 AND source_sha256=$3`,
          [ownerId, job.semester_id, job.source_sha256],
        );
        // The commit record outlives the courses it created: after a cleanup,
        // re-importing the same file used to "succeed" without writing a
        // single row (the success copy promised 22 courses, the list stayed
        // empty). Reuse only while every original course is still alive;
        // otherwise fall through to insertion and keep survivors matched by
        // name so a partial cleanup can never duplicate them.
        const priorResult = priorSource.rows[0]?.result ?? null;
        let survivorsByName = new Map<string, string>();
        if (priorResult && priorResult.course_ids.length) {
          const alive = await query.query<{ id: string; name: string }>(
            `SELECT id,name FROM courses
             WHERE owner_id=$1 AND semester_id=$2 AND deleted_at IS NULL
               AND id = ANY($3::uuid[])`,
            [ownerId, job.semester_id, priorResult.course_ids],
          );
          if (alive.rows.length === priorResult.course_ids.length) {
            const result = {
              ...priorResult,
              reused_existing_import: true,
            };
            await this.finishCommit(
              query,
              ownerId,
              job.id,
              idempotencyKey,
              requestHash,
              result,
            );
            return result;
          }
          survivorsByName = new Map(
            alive.rows.map((row) => [row.name, row.id]),
          );
        }

        const courseIds: string[] = [];
        for (const incoming of job.preview) {
          const resolution = job.resolutions[incoming.name];
          if (incoming.duplicate_candidates.length && !resolution)
            throw new CloudError(
              "VALIDATION_ERROR",
              409,
              "Course import still needs duplicate decisions",
            );
          const survivor = survivorsByName.get(incoming.name);
          if (survivor) {
            // This course survived the cleanup: keep its row (and the
            // schedules it already owns) instead of creating a twin.
            courseIds.push(survivor);
            continue;
          }
          const courseId = randomUUID();
          const inserted = await query.query<{
            value: Record<string, unknown>;
          }>(
            `WITH value AS (
               INSERT INTO courses
               (id,owner_id,semester_id,name,instructor,created_at,updated_at,deleted_at,row_version)
               VALUES ($1,$2,$3,$4,$5,now(),now(),NULL,1) RETURNING *
             ) SELECT row_to_json(value) AS value FROM value`,
            [
              courseId,
              ownerId,
              job.semester_id,
              incoming.name,
              incoming.instructor,
            ],
          );
          await logEntity(
            query,
            ownerId,
            "COURSE",
            courseId,
            inserted.rows[0]!.value,
          );
          courseIds.push(courseId);

          if (
            resolution?.decision === "SAME_COURSE" &&
            resolution.existing_course_id
          ) {
            const information = await query.query<{
              value: CourseInformation;
            }>(
              `SELECT row_to_json(i) AS value FROM course_information i
               WHERE owner_id=$1 AND course_id=$2 AND deleted_at IS NULL
               ORDER BY created_at,id`,
              [ownerId, resolution.existing_course_id],
            );
            for (const { value } of information.rows) {
              const informationId = randomUUID();
              const copied = await query.query<{
                value: Record<string, unknown>;
              }>(
                `WITH inserted AS (
                   INSERT INTO course_information
                   (id,owner_id,course_id,content,created_at,updated_at,deleted_at,row_version)
                   VALUES ($1,$2,$3,$4,now(),now(),NULL,1) RETURNING *
                 ) SELECT row_to_json(inserted) AS value FROM inserted`,
                [informationId, ownerId, courseId, value.content],
              );
              await logEntity(
                query,
                ownerId,
                "COURSE_INFORMATION",
                informationId,
                copied.rows[0]!.value,
              );
            }
          }

          for (const schedule of incoming.schedules) {
            await query.query(
              `INSERT INTO course_schedules
               (id,owner_id,course_id,weekday,start_time,end_time,week_start,week_end,
                classroom,stage_label,created_at,updated_at,deleted_at,row_version)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now(),now(),NULL,1)`,
              [
                randomUUID(),
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
          }
          await recordExternalCollectionReplacement(
            query,
            ownerId,
            "COURSE_SCHEDULE_COLLECTION",
            courseId,
          );
        }

        const result: CourseImportCommitResult = {
          course_ids: courseIds,
          reused_existing_import: false,
        };
        await query.query(
          `INSERT INTO course_import_commits
           (owner_id,semester_id,source_sha256,job_id,result)
           VALUES ($1,$2,$3,$4,$5::jsonb)
           ON CONFLICT (owner_id,semester_id,source_sha256)
           DO UPDATE SET job_id=$4,result=$5::jsonb,committed_at=now()`,
          [
            ownerId,
            job.semester_id,
            job.source_sha256,
            job.id,
            JSON.stringify(result),
          ],
        );
        await this.finishCommit(
          query,
          ownerId,
          job.id,
          idempotencyKey,
          requestHash,
          result,
        );
        return result;
      });

    try {
      return await work();
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

  private async finishCommit(
    query: QueryPort,
    ownerId: string,
    jobId: string,
    idempotencyKey: string,
    requestHash: string,
    result: CourseImportCommitResult,
  ) {
    await query.query(
      `UPDATE course_import_jobs SET status='COMMITTED',commit_result=$3::jsonb,
       error_message=NULL,committed_at=now(),updated_at=now()
       WHERE id=$1 AND owner_id=$2`,
      [jobId, ownerId, JSON.stringify(result)],
    );
    await query.query(
      "INSERT INTO idempotency_keys (owner_id,mutation_id,request_hash,response) VALUES ($1,$2,$3,$4::jsonb)",
      [ownerId, idempotencyKey, requestHash, JSON.stringify(result)],
    );
  }
}
