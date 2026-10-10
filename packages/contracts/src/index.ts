import { z } from "zod";

export const uuidSchema = z.string().uuid();
export const isoDateTimeSchema = z.string().datetime({ offset: true });
export const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const itemStatusSchema = z.enum(["INCOMPLETE", "COMPLETE"]);
export const reminderLevelSchema = z.enum(["OFF", "NORMAL", "HIGH"]);
export const rawCaptureStatusSchema = z.enum([
  "RAW",
  "PROCESSING",
  "RESOLVED",
  "UNRESOLVED",
  "DELETED",
]);

export const createRawCaptureSchema = z.object({
  source: z.enum(["QUICK_CAPTURE", "COURSE_ITEM", "COURSE_INFORMATION"]),
  raw_text: z.string().min(1).max(10000),
  captured_at: isoDateTimeSchema,
  /** IANA timezone at capture. New local writes always set it; legacy payloads may omit. */
  captured_tz: z.string().min(1).max(64).nullish(),
});

// New fields introduced by 007/ADR-010: pre-007 clients omit these keys
// entirely in sync payloads. ADR-010 §4 requires "缺省视为 null", so absence
// is normalized to null instead of rejected.
const dateOnlyOrMissing = dateOnlySchema
  .nullish()
  .transform((value) => value ?? null);
const zoneOrMissing = z
  .string()
  .min(1)
  .max(64)
  .nullish()
  .transform((value) => value ?? null);

export const itemFieldsSchema = z.object({
  title: z.string().trim().min(1).max(500),
  detail: z.string().max(20000).nullable(),
  course_id: uuidSchema.nullable(),
  status: itemStatusSchema,
  start_at: isoDateTimeSchema.nullable(),
  start_date: dateOnlyOrMissing,
  occurrence_start_at: isoDateTimeSchema.nullable(),
  occurrence_start_date: dateOnlyOrMissing,
  occurrence_end_at: isoDateTimeSchema.nullable(),
  occurrence_end_date: dateOnlyOrMissing,
  due_at: isoDateTimeSchema.nullable(),
  due_date: dateOnlyOrMissing,
  time_zone: zoneOrMissing,
  reminder_level: reminderLevelSchema,
  raw_capture_id: uuidSchema.nullable(),
});

const mutuallyExclusivePairs = [
  ["start_at", "start_date"],
  ["occurrence_start_at", "occurrence_start_date"],
  ["occurrence_end_at", "occurrence_end_date"],
  ["due_at", "due_date"],
] as const;

function datePrecisionOk(value: {
  start_at?: string | null | undefined;
  start_date?: string | null | undefined;
  occurrence_start_at?: string | null | undefined;
  occurrence_start_date?: string | null | undefined;
  occurrence_end_at?: string | null | undefined;
  occurrence_end_date?: string | null | undefined;
  due_at?: string | null | undefined;
  due_date?: string | null | undefined;
}): boolean {
  return mutuallyExclusivePairs.every(([at, date]) => {
    const hasAt = value[at] != null && value[at] !== "";
    const hasDate = value[date] != null && value[date] !== "";
    return !(hasAt && hasDate);
  });
}

export const createItemSchema = itemFieldsSchema
  .refine(datePrecisionOk, {
    message: "Each time endpoint is either DATE or DATETIME, not both",
  })
  .refine(
    (value) =>
      !value.occurrence_start_at ||
      !value.occurrence_end_at ||
      value.occurrence_start_at <= value.occurrence_end_at,
    { message: "Occurrence end must not precede start" },
  )
  .refine(
    (value) =>
      !value.occurrence_start_date ||
      !value.occurrence_end_date ||
      value.occurrence_start_date <= value.occurrence_end_date,
    { message: "Occurrence end date must not precede start date" },
  );
export const updateItemSchema = itemFieldsSchema
  .omit({ status: true, raw_capture_id: true })
  .partial()
  .refine(datePrecisionOk, {
    message: "Each time endpoint is either DATE or DATETIME, not both",
  });
export const createCourseSchema = z.object({
  name: z.string().trim().min(1).max(300),
  semester_id: uuidSchema.nullable(),
  instructor: z.string().max(300).nullable(),
});

export const apiErrorCodes = [
  "AUTH_REQUIRED",
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION_ERROR",
  "IDEMPOTENCY_REPLAY",
  "VERSION_CONFLICT",
  "IMPORT_FAILED",
  "AI_UNAVAILABLE",
  "AI_INVALID_OUTPUT",
  "SYNC_CURSOR_INVALID",
  "RATE_LIMITED",
  "SERVER_ERROR",
] as const;

export type CreateRawCaptureInput = z.infer<typeof createRawCaptureSchema>;
export type CreateItemInput = z.infer<typeof createItemSchema>;
export type CreateCourseInput = z.infer<typeof createCourseSchema>;
export * from "./interpretation.js";
export * from "./conflicts.js";
export * from "./course-import.js";
