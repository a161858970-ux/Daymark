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
});

export const itemFieldsSchema = z.object({
  title: z.string().trim().min(1).max(500),
  detail: z.string().max(20000).nullable(),
  course_id: uuidSchema.nullable(),
  status: itemStatusSchema,
  start_at: isoDateTimeSchema.nullable(),
  occurrence_start_at: isoDateTimeSchema.nullable(),
  occurrence_end_at: isoDateTimeSchema.nullable(),
  due_at: isoDateTimeSchema.nullable(),
  reminder_level: reminderLevelSchema,
  raw_capture_id: uuidSchema.nullable(),
});

export const createItemSchema = itemFieldsSchema.refine(
  (value) =>
    !value.occurrence_start_at ||
    !value.occurrence_end_at ||
    value.occurrence_start_at <= value.occurrence_end_at,
  { message: "Occurrence end must not precede start" },
);
export const updateItemSchema = itemFieldsSchema
  .omit({ status: true, raw_capture_id: true })
  .partial();
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
