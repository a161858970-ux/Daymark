import Fastify from "fastify";
import { z, ZodError } from "zod";
import {
  createCourseSchema,
  courseImportResolutionSchema,
  courseImportSourceSchema,
  courseImportStartSchema,
  createItemSchema,
  createRawCaptureSchema,
  isoDateTimeSchema,
  interpretationRequestSchema,
  itemStatusSchema,
  uuidSchema,
} from "@course-manager/contracts";
import { CloudCourseManager, CloudError } from "./db/cloud.js";
import { CloudSync, syncMutationSchema } from "./db/sync.js";
import {
  CloudAcademicManager,
  scheduleInputSchema,
  semesterInputSchema,
  semesterPatchSchema,
  weekInputSchema,
} from "./db/academic.js";
import { CaptureInterpretationService } from "./ai/interpretation.js";
import {
  CloudConflictManager,
  conflictResolutionSchema,
} from "./db/conflicts.js";
import { CloudCourseImportManager } from "./db/course-import.js";
import {
  CloudNotificationManager,
  deviceRegistrationSchema,
  notificationAcknowledgeSchema,
  notificationCancelSchema,
  notificationClaimSchema,
} from "./db/notifications.js";

export interface ServerDependencies {
  cloud: CloudCourseManager;
  sync?: CloudSync;
  academic?: CloudAcademicManager;
  interpretation?: CaptureInterpretationService;
  conflicts?: CloudConflictManager;
  courseImports?: CloudCourseImportManager;
  notifications?: CloudNotificationManager;
  verifyToken(token: string): Promise<string | null>;
}

// A 15 MB file expands to roughly 20 MB as base64 JSON.
const apiBodyLimitBytes = 21_500_000;

const pageSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const coursePatchSchema = createCourseSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0);
const courseInformationInputSchema = z.object({
  content: z.string().trim().min(1).max(20000),
});
const associationInputSchema = z.object({
  item_id_a: uuidSchema,
  item_id_b: uuidSchema,
});

function readCursor(value: string | undefined, scope: string) {
  if (!value) return { after: null, asOf: null };
  try {
    const parsed = z
      .object({
        after: uuidSchema,
        scope: z.string(),
        asOf: isoDateTimeSchema.nullable(),
      })
      .parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
    if (parsed.scope !== scope) throw new Error("Wrong list scope");
    return { after: parsed.after, asOf: parsed.asOf };
  } catch {
    throw new CloudError("VALIDATION_ERROR", 400, "Invalid list cursor");
  }
}

function nextCursor(
  after: string | null,
  scope: string,
  asOf: string | null = null,
) {
  return after
    ? Buffer.from(JSON.stringify({ after, scope, asOf }), "utf8").toString(
        "base64url",
      )
    : null;
}

function dateInZone(instant: string, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(instant));
    const part = (type: string) =>
      parts.find((value) => value.type === type)!.value;
    return `${part("year")}-${part("month")}-${part("day")}`;
  } catch {
    throw new CloudError("VALIDATION_ERROR", 400, "Invalid time zone");
  }
}

/**
 * The Fastify logger is deliberately off, so an error that carries an
 * engineering cause (provider failure, schema rejection) writes exactly one
 * line to stderr -- it lands in the API log file, never in the response body,
 * which stays product-level language.
 */
function logEngineeringCause(error: CloudError): void {
  if (error.cause === undefined) return;
  const cause = error.cause;
  const detail =
    cause instanceof Error ? (cause.stack ?? cause.message) : String(cause);
  // The stack of the first wrapper rarely says why the request died; walk the
  // cause chain so a body-timeout or a socket reset is visible in the log
  // instead of a bare "UNAVAILABLE" that has to be guessed at.
  const chain: string[] = [];
  let current: unknown = cause;
  while (current instanceof Error && chain.length < 5) {
    chain.push(`${current.name}: ${current.message}`);
    current = (current as { cause?: unknown }).cause;
  }
  console.error(
    `[${error.code}] ${detail}\n  cause-chain: ${chain.join(" <- ")}`,
  );
}

/** Domain routes are registered only when both persistence and auth are supplied. */
export function buildServer(dependencies?: ServerDependencies) {
  const server = Fastify({ logger: false, bodyLimit: apiBodyLimitBytes });
  server.setErrorHandler((error, _request, reply) => {
    if (error instanceof CloudError) {
      logEngineeringCause(error);
      const retryAfter = error.details.retry_after_seconds;
      if (error.code === "RATE_LIMITED" && typeof retryAfter === "number")
        reply.header("Retry-After", String(retryAfter));
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
      });
    }
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid request",
          details: { issues: error.issues },
        },
      });
    }
    // Unexpected failures were previously invisible (logger off, no handler
    // log), which made production incidents unreproducible.
    console.error("[SERVER_ERROR]", error);
    return reply.status(500).send({
      error: { code: "SERVER_ERROR", message: "Server error", details: {} },
    });
  });
  server.get("/api/v1/health", async () => ({
    data: { status: "ok" },
    meta: {},
  }));
  if (dependencies) {
    async function owner(authorization: string | undefined) {
      const match = /^Bearer (\S+)$/i.exec(authorization ?? "");
      if (!match)
        throw new CloudError("AUTH_REQUIRED", 401, "Authentication required");
      const ownerId = await dependencies!.verifyToken(match[1]!);
      if (!ownerId)
        throw new CloudError("AUTH_REQUIRED", 401, "Authentication required");
      return uuidSchema.parse(ownerId);
    }
    function mutationKey(value: string | string[] | undefined) {
      if (typeof value !== "string")
        throw new CloudError(
          "VALIDATION_ERROR",
          400,
          "Idempotency-Key is required",
        );
      return uuidSchema.parse(value);
    }
    function ifMatch(value: string | undefined, minimum = 1) {
      const parsed = Number(value);
      if (!value || !Number.isSafeInteger(parsed) || parsed < minimum)
        throw new CloudError(
          "VALIDATION_ERROR",
          400,
          "If-Match row version is required",
        );
      return parsed;
    }
    if (dependencies.interpretation) {
      server.post("/api/v1/ai/capture-interpretations", async (request) => {
        const ownerId = await owner(request.headers.authorization);
        const body = interpretationRequestSchema.parse(request.body);
        return {
          data: await dependencies.interpretation!.interpret(ownerId, body),
          meta: {},
        };
      });
    }
    if (dependencies.sync) {
      server.get("/api/v1/sync/identity", async (request) => ({
        data: { owner_id: await owner(request.headers.authorization) },
        meta: {},
      }));
      server.post("/api/v1/sync/push", async (request) => {
        const ownerId = await owner(request.headers.authorization);
        const body = z
          .object({
            device_id: uuidSchema,
            mutations: z.array(syncMutationSchema).min(1).max(50),
          })
          .parse(request.body);
        const data = [];
        for (const mutation of body.mutations)
          data.push(await dependencies.sync!.pushOne(ownerId, mutation));
        return { data, meta: {} };
      });
      server.get("/api/v1/sync/changes", async (request) => {
        const ownerId = await owner(request.headers.authorization);
        const query = z
          .object({
            cursor: z.string().optional(),
            limit: z.coerce.number().int().min(1).max(500).default(500),
          })
          .parse(request.query);
        const result = await dependencies.sync!.changes(
          ownerId,
          query.cursor,
          query.limit,
        );
        return {
          data: result.data,
          meta: { next_cursor: result.next_cursor, has_more: result.has_more },
        };
      });
    }
    if (dependencies.conflicts) {
      server.get("/api/v1/sync/conflicts", async (request) => ({
        data: await dependencies.conflicts!.list(
          await owner(request.headers.authorization),
        ),
        meta: {},
      }));
      server.get("/api/v1/sync/conflicts/:id", async (request) => {
        const ownerId = await owner(request.headers.authorization);
        const id = uuidSchema.parse((request.params as { id: string }).id);
        return {
          data: await dependencies.conflicts!.get(ownerId, id),
          meta: {},
        };
      });
      server.post("/api/v1/sync/conflicts/:id/resolve", async (request) => {
        const ownerId = await owner(request.headers.authorization);
        const id = uuidSchema.parse((request.params as { id: string }).id);
        const key = mutationKey(request.headers["idempotency-key"]);
        const version = ifMatch(request.headers["if-match"], 0);
        const input = conflictResolutionSchema.parse(request.body);
        return {
          data: await dependencies.conflicts!.resolve(
            ownerId,
            id,
            key,
            version,
            input,
          ),
          meta: {},
        };
      });
    }
    if (dependencies.academic) {
      server.post("/api/v1/semesters", async (request) => {
        const ownerId = await owner(request.headers.authorization);
        const key = mutationKey(request.headers["idempotency-key"]);
        const input = semesterInputSchema.parse(request.body);
        return {
          data: await dependencies.academic!.createSemester(
            ownerId,
            key,
            input,
          ),
          meta: {},
        };
      });
      server.get("/api/v1/semesters", async (request) => {
        const ownerId = await owner(request.headers.authorization);
        return {
          data: await dependencies.academic!.semesters(ownerId),
          meta: {},
        };
      });
      server.get("/api/v1/semesters/:id", async (request) => {
        const ownerId = await owner(request.headers.authorization);
        const id = uuidSchema.parse((request.params as { id: string }).id);
        const value = await dependencies.academic!.semester(ownerId, id);
        if (!value)
          throw new CloudError("NOT_FOUND", 404, "Semester not found");
        return { data: value, meta: {} };
      });
      server.patch("/api/v1/semesters/:id", async (request) => {
        const ownerId = await owner(request.headers.authorization);
        const id = uuidSchema.parse((request.params as { id: string }).id);
        const key = mutationKey(request.headers["idempotency-key"]);
        const version = ifMatch(request.headers["if-match"]);
        const input = semesterPatchSchema.parse(request.body);
        return {
          data: await dependencies.academic!.updateSemester(
            ownerId,
            id,
            key,
            version,
            input,
          ),
          meta: {},
        };
      });
      server.get("/api/v1/semesters/:id/weeks", async (request) => {
        const ownerId = await owner(request.headers.authorization);
        const id = uuidSchema.parse((request.params as { id: string }).id);
        return {
          data: await dependencies.academic!.weeks(ownerId, id),
          meta: {},
        };
      });
      server.put("/api/v1/semesters/:id/weeks", async (request) => {
        const ownerId = await owner(request.headers.authorization);
        const id = uuidSchema.parse((request.params as { id: string }).id);
        const key = mutationKey(request.headers["idempotency-key"]);
        const input = z
          .object({ weeks: z.array(weekInputSchema) })
          .parse(request.body);
        return {
          data: await dependencies.academic!.replaceWeeks(
            ownerId,
            id,
            key,
            input.weeks,
          ),
          meta: {},
        };
      });
      server.get("/api/v1/courses/:id/schedules", async (request) => {
        const ownerId = await owner(request.headers.authorization);
        const id = uuidSchema.parse((request.params as { id: string }).id);
        return {
          data: await dependencies.academic!.schedules(ownerId, id),
          meta: {},
        };
      });
      server.put("/api/v1/courses/:id/schedules", async (request) => {
        const ownerId = await owner(request.headers.authorization);
        const id = uuidSchema.parse((request.params as { id: string }).id);
        const key = mutationKey(request.headers["idempotency-key"]);
        const input = z
          .object({ schedules: z.array(scheduleInputSchema) })
          .parse(request.body);
        return {
          data: await dependencies.academic!.replaceSchedules(
            ownerId,
            id,
            key,
            input.schedules,
          ),
          meta: {},
        };
      });
    }
    if (dependencies.courseImports) {
      server.post("/api/v1/course-imports", async (request) => {
        const ownerId = await owner(request.headers.authorization);
        const input = courseImportStartSchema.parse(request.body);
        return {
          data: await dependencies.courseImports!.start(
            ownerId,
            input.semester_id,
            input.source_type,
          ),
          meta: {},
        };
      });
      server.get("/api/v1/course-imports", async (request) => {
        const ownerId = await owner(request.headers.authorization);
        const query = z
          .object({ semester_id: uuidSchema.optional() })
          .parse(request.query);
        return {
          data: await dependencies.courseImports!.listPending(
            ownerId,
            query.semester_id,
          ),
          meta: {},
        };
      });
      server.get("/api/v1/course-imports/:id", async (request) => {
        const ownerId = await owner(request.headers.authorization);
        const id = uuidSchema.parse((request.params as { id: string }).id);
        return {
          data: await dependencies.courseImports!.get(ownerId, id),
          meta: {},
        };
      });
      server.post("/api/v1/course-imports/:id/source", async (request) => {
        const ownerId = await owner(request.headers.authorization);
        const id = uuidSchema.parse((request.params as { id: string }).id);
        return {
          data: await dependencies.courseImports!.parseSource(
            ownerId,
            id,
            courseImportSourceSchema.parse(request.body),
          ),
          meta: {},
        };
      });
      server.post(
        "/api/v1/course-imports/:id/resolve-course",
        async (request) => {
          const ownerId = await owner(request.headers.authorization);
          const id = uuidSchema.parse((request.params as { id: string }).id);
          return {
            data: await dependencies.courseImports!.resolveCourse(
              ownerId,
              id,
              courseImportResolutionSchema.parse(request.body),
            ),
            meta: {},
          };
        },
      );
      server.post("/api/v1/course-imports/:id/commit", async (request) => {
        const ownerId = await owner(request.headers.authorization);
        const id = uuidSchema.parse((request.params as { id: string }).id);
        return {
          data: await dependencies.courseImports!.commit(
            ownerId,
            id,
            mutationKey(request.headers["idempotency-key"]),
          ),
          meta: {},
        };
      });
      server.delete("/api/v1/course-imports/:id", async (request) => {
        const ownerId = await owner(request.headers.authorization);
        const id = uuidSchema.parse((request.params as { id: string }).id);
        await dependencies.courseImports!.discard(ownerId, id);
        return { data: { id }, meta: {} };
      });
    }
    if (dependencies.notifications) {
      server.post("/api/v1/devices", async (request) => {
        const ownerId = await owner(request.headers.authorization);
        return {
          data: await dependencies.notifications!.registerDevice(
            ownerId,
            deviceRegistrationSchema.parse(request.body),
          ),
          meta: {},
        };
      });
      server.post("/api/v1/notifications/claim", async (request) => {
        const ownerId = await owner(request.headers.authorization);
        return {
          data: await dependencies.notifications!.claim(
            ownerId,
            notificationClaimSchema.parse(request.body),
          ),
          meta: {},
        };
      });
      server.post("/api/v1/notifications/:id/delivered", async (request) => {
        const ownerId = await owner(request.headers.authorization);
        const id = uuidSchema.parse((request.params as { id: string }).id);
        const body = notificationAcknowledgeSchema.parse(request.body);
        await dependencies.notifications!.acknowledge(
          ownerId,
          id,
          body.device_id,
        );
        return { data: { delivery_id: id, delivered: true }, meta: {} };
      });
      server.post("/api/v1/notifications/cancel", async (request) => {
        const ownerId = await owner(request.headers.authorization);
        const body = notificationCancelSchema.parse(request.body);
        return {
          data: {
            canceled: await dependencies.notifications!.cancel(
              ownerId,
              body.logical_keys,
            ),
          },
          meta: {},
        };
      });
    }
    server.post("/api/v1/raw-captures", async (request) => {
      const ownerId = await owner(request.headers.authorization);
      const key = mutationKey(request.headers["idempotency-key"]);
      const input = createRawCaptureSchema.parse(request.body);
      return {
        data: await dependencies.cloud.createRawCapture(ownerId, key, input),
        meta: {},
      };
    });
    server.get("/api/v1/raw-captures", async (request) => {
      const ownerId = await owner(request.headers.authorization);
      const query = pageSchema
        .extend({
          processing_status: z.literal("UNRESOLVED"),
        })
        .parse(request.query);
      const cursor = readCursor(query.cursor, "raw-captures:unresolved");
      const result = await dependencies.cloud.listUnresolvedCaptures(
        ownerId,
        cursor.after,
        query.limit,
      );
      return {
        data: result.data,
        meta: {
          next_cursor: nextCursor(
            result.next_cursor,
            "raw-captures:unresolved",
          ),
        },
      };
    });
    server.get("/api/v1/raw-captures/:id", async (request) => {
      const ownerId = await owner(request.headers.authorization);
      const id = uuidSchema.parse((request.params as { id: string }).id);
      const capture = await dependencies.cloud.getRawCapture(ownerId, id);
      if (!capture)
        throw new CloudError("NOT_FOUND", 404, "Raw capture not found");
      return { data: capture, meta: {} };
    });
    server.delete("/api/v1/raw-captures/:id", async (request) => {
      const ownerId = await owner(request.headers.authorization);
      const id = uuidSchema.parse((request.params as { id: string }).id);
      return {
        data: await dependencies.cloud.deleteRawCapture(
          ownerId,
          id,
          mutationKey(request.headers["idempotency-key"]),
          ifMatch(request.headers["if-match"]),
        ),
        meta: {},
      };
    });
    server.post("/api/v1/courses", async (request) => {
      const ownerId = await owner(request.headers.authorization);
      const key = mutationKey(request.headers["idempotency-key"]);
      const input = createCourseSchema.parse(request.body);
      return {
        data: await dependencies.cloud.createCourse(ownerId, key, input),
        meta: {},
      };
    });
    server.get("/api/v1/courses", async (request) => {
      const ownerId = await owner(request.headers.authorization);
      const query = pageSchema
        .extend({ semester_id: uuidSchema.optional() })
        .parse(request.query);
      const scope = `courses:${query.semester_id ?? "null"}`;
      const cursor = readCursor(query.cursor, scope);
      const result = await dependencies.cloud.listCourses(
        ownerId,
        query.semester_id ?? null,
        cursor.after,
        query.limit,
      );
      return {
        data: result.data,
        meta: { next_cursor: nextCursor(result.next_cursor, scope) },
      };
    });
    server.get("/api/v1/courses/:id", async (request) => {
      const ownerId = await owner(request.headers.authorization);
      const id = uuidSchema.parse((request.params as { id: string }).id);
      const course = await dependencies.cloud.getCourse(ownerId, id);
      if (!course) throw new CloudError("NOT_FOUND", 404, "Course not found");
      return { data: course, meta: {} };
    });
    server.patch("/api/v1/courses/:id", async (request) => {
      const ownerId = await owner(request.headers.authorization);
      const id = uuidSchema.parse((request.params as { id: string }).id);
      return {
        data: await dependencies.cloud.updateCourse(
          ownerId,
          id,
          mutationKey(request.headers["idempotency-key"]),
          ifMatch(request.headers["if-match"]),
          coursePatchSchema.parse(request.body),
        ),
        meta: {},
      };
    });
    server.post("/api/v1/courses/:id/delete-with-strategy", async (request) => {
      const ownerId = await owner(request.headers.authorization);
      const id = uuidSchema.parse((request.params as { id: string }).id);
      const key = mutationKey(request.headers["idempotency-key"]);
      const version = ifMatch(request.headers["if-match"]);
      const body = z
        .object({
          strategy: z.enum([
            "DELETE_ASSOCIATED_ITEMS",
            "UNLINK_ASSOCIATED_ITEMS",
          ]),
          item_versions: z
            .array(
              z.object({
                id: uuidSchema,
                row_version: z.number().int().positive(),
              }),
            )
            .optional(),
        })
        .parse(request.body);
      return {
        data: await dependencies.cloud.deleteCourseWithStrategy(
          ownerId,
          id,
          key,
          version,
          body.strategy,
          body.item_versions,
        ),
        meta: {},
      };
    });
    server.get("/api/v1/courses/:id/information", async (request) => {
      const ownerId = await owner(request.headers.authorization);
      const courseId = uuidSchema.parse((request.params as { id: string }).id);
      const query = pageSchema.parse(request.query);
      const scope = `course-information:${courseId}`;
      const cursor = readCursor(query.cursor, scope);
      const result = await dependencies.cloud.listCourseInformation(
        ownerId,
        courseId,
        cursor.after,
        query.limit,
      );
      return {
        data: result.data,
        meta: { next_cursor: nextCursor(result.next_cursor, scope) },
      };
    });
    server.post("/api/v1/courses/:id/information", async (request) => {
      const ownerId = await owner(request.headers.authorization);
      const courseId = uuidSchema.parse((request.params as { id: string }).id);
      const input = courseInformationInputSchema.parse(request.body);
      return {
        data: await dependencies.cloud.createCourseInformation(
          ownerId,
          courseId,
          mutationKey(request.headers["idempotency-key"]),
          input.content,
        ),
        meta: {},
      };
    });
    server.patch("/api/v1/course-information/:id", async (request) => {
      const ownerId = await owner(request.headers.authorization);
      const id = uuidSchema.parse((request.params as { id: string }).id);
      const input = courseInformationInputSchema.parse(request.body);
      return {
        data: await dependencies.cloud.updateCourseInformation(
          ownerId,
          id,
          mutationKey(request.headers["idempotency-key"]),
          ifMatch(request.headers["if-match"]),
          input.content,
        ),
        meta: {},
      };
    });
    server.delete("/api/v1/course-information/:id", async (request) => {
      const ownerId = await owner(request.headers.authorization);
      const id = uuidSchema.parse((request.params as { id: string }).id);
      return {
        data: await dependencies.cloud.deleteCourseInformation(
          ownerId,
          id,
          mutationKey(request.headers["idempotency-key"]),
          ifMatch(request.headers["if-match"]),
        ),
        meta: {},
      };
    });
    server.post("/api/v1/items", async (request) => {
      const ownerId = await owner(request.headers.authorization);
      const key = mutationKey(request.headers["idempotency-key"]);
      const input = createItemSchema.parse(request.body);
      if (input.status !== "INCOMPLETE")
        throw new CloudError(
          "VALIDATION_ERROR",
          400,
          "New Item must be incomplete",
        );
      return {
        data: await dependencies.cloud.createItem(ownerId, key, input),
        meta: {},
      };
    });
    server.get("/api/v1/items/overview", async (request) => {
      const ownerId = await owner(request.headers.authorization);
      const query = pageSchema
        .extend({ semester_id: uuidSchema.optional() })
        .parse(request.query);
      const timeZone = request.headers["x-time-zone"] ?? "UTC";
      if (typeof timeZone !== "string")
        throw new CloudError("VALIDATION_ERROR", 400, "Invalid time zone");
      const scope = `overview:${query.semester_id ?? "current"}:${timeZone}`;
      const cursor = readCursor(query.cursor, scope);
      const asOf = cursor.asOf ?? new Date().toISOString();
      const result = await dependencies.cloud.overview(
        ownerId,
        dateInZone(asOf, timeZone),
        asOf,
        query.semester_id,
        cursor.after,
        query.limit,
      );
      return {
        data: result.data,
        meta: { next_cursor: nextCursor(result.next_cursor, scope, asOf) },
      };
    });
    server.get("/api/v1/items", async (request) => {
      const ownerId = await owner(request.headers.authorization);
      const query = pageSchema
        .extend({
          course_id: uuidSchema.optional(),
          status: itemStatusSchema.optional(),
          has_time: z.enum(["true", "false"]).optional(),
          from: isoDateTimeSchema.optional(),
          to: isoDateTimeSchema.optional(),
        })
        .parse(request.query);
      if (query.from && query.to && query.from > query.to)
        throw new CloudError("VALIDATION_ERROR", 400, "Invalid time range");
      const filters = {
        course_id: query.course_id,
        status: query.status,
        has_time:
          query.has_time === undefined ? undefined : query.has_time === "true",
        from: query.from,
        to: query.to,
      };
      const scope = `items:${JSON.stringify(filters)}`;
      const cursor = readCursor(query.cursor, scope);
      const result = await dependencies.cloud.listItems(
        ownerId,
        filters,
        cursor.after,
        query.limit,
      );
      return {
        data: result.data,
        meta: { next_cursor: nextCursor(result.next_cursor, scope) },
      };
    });
    server.get("/api/v1/items/:id", async (request) => {
      const ownerId = await owner(request.headers.authorization);
      const id = uuidSchema.parse((request.params as { id: string }).id);
      const item = await dependencies.cloud.getItem(ownerId, id);
      if (!item) throw new CloudError("NOT_FOUND", 404, "Item not found");
      return { data: item, meta: {} };
    });
    server.post("/api/v1/item-associations", async (request) => {
      const ownerId = await owner(request.headers.authorization);
      const input = associationInputSchema.parse(request.body);
      return {
        data: await dependencies.cloud.createItemAssociation(
          ownerId,
          mutationKey(request.headers["idempotency-key"]),
          input.item_id_a,
          input.item_id_b,
        ),
        meta: {},
      };
    });
    server.get("/api/v1/items/:id/associations", async (request) => {
      const ownerId = await owner(request.headers.authorization);
      const itemId = uuidSchema.parse((request.params as { id: string }).id);
      return {
        data: await dependencies.cloud.listItemAssociations(ownerId, itemId),
        meta: {},
      };
    });
    server.delete("/api/v1/item-associations/:id", async (request) => {
      const ownerId = await owner(request.headers.authorization);
      const id = uuidSchema.parse((request.params as { id: string }).id);
      return {
        data: await dependencies.cloud.deleteItemAssociation(
          ownerId,
          id,
          mutationKey(request.headers["idempotency-key"]),
          ifMatch(request.headers["if-match"]),
        ),
        meta: {},
      };
    });
    server.patch("/api/v1/items/:id", async (request) => {
      const ownerId = await owner(request.headers.authorization);
      const id = uuidSchema.parse((request.params as { id: string }).id);
      const key = mutationKey(request.headers["idempotency-key"]);
      const version = ifMatch(request.headers["if-match"]);
      return {
        data: await dependencies.cloud.updateItem(
          ownerId,
          id,
          key,
          version,
          request.body,
        ),
        meta: {},
      };
    });
    server.post("/api/v1/items/:id/complete", async (request) => {
      const ownerId = await owner(request.headers.authorization);
      const id = uuidSchema.parse((request.params as { id: string }).id);
      const key = mutationKey(request.headers["idempotency-key"]);
      const version = ifMatch(request.headers["if-match"]);
      return {
        data: await dependencies.cloud.setItemComplete(
          ownerId,
          id,
          key,
          version,
          true,
        ),
        meta: {},
      };
    });
    server.post("/api/v1/items/:id/restore", async (request) => {
      const ownerId = await owner(request.headers.authorization);
      const id = uuidSchema.parse((request.params as { id: string }).id);
      const key = mutationKey(request.headers["idempotency-key"]);
      const version = ifMatch(request.headers["if-match"]);
      return {
        data: await dependencies.cloud.setItemComplete(
          ownerId,
          id,
          key,
          version,
          false,
        ),
        meta: {},
      };
    });
    server.delete("/api/v1/items/:id", async (request) => {
      const ownerId = await owner(request.headers.authorization);
      const id = uuidSchema.parse((request.params as { id: string }).id);
      const key = mutationKey(request.headers["idempotency-key"]);
      const version = ifMatch(request.headers["if-match"]);
      return {
        data: await dependencies.cloud.deleteItem(ownerId, id, key, version),
        meta: {},
      };
    });
    server.post("/api/v1/items/:id/undo-delete", async (request) => {
      const ownerId = await owner(request.headers.authorization);
      const id = uuidSchema.parse((request.params as { id: string }).id);
      const key = mutationKey(request.headers["idempotency-key"]);
      const token = request.headers["x-undo-token"];
      if (typeof token !== "string" || !token)
        throw new CloudError(
          "VALIDATION_ERROR",
          400,
          "X-Undo-Token is required",
        );
      return {
        data: await dependencies.cloud.undoDelete(ownerId, id, key, token),
        meta: {},
      };
    });
  }
  return server;
}
