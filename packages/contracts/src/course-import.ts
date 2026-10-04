import { z } from "zod";

const uuidSchema = z.string().uuid();

export const courseImportSourceTypeSchema = z.enum(["PDF", "IMAGE"]);

export const courseImportScheduleSchema = z
  .object({
    weekday: z.number().int().min(1).max(7),
    // null: the source gives periods only, no clock time — an absent fact
    // is stored as absent, never guessed.
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
    classroom: z.string().trim().max(500).nullable(),
    stage_label: z.string().trim().max(500).nullable(),
  })
  .strict()
  .refine(
    (value) => (value.start_time === null) === (value.end_time === null),
    {
      message: "Course schedule must hold both times or neither",
    },
  )
  .refine(
    (value) =>
      value.start_time === null ||
      (value.end_time !== null && value.start_time < value.end_time),
    {
      message: "Course schedule end must follow start",
    },
  )
  .refine(
    (value) =>
      value.week_start === null ||
      value.week_end === null ||
      value.week_start <= value.week_end,
    { message: "Course schedule week range is invalid" },
  );

export const courseImportCandidateSchema = z
  .object({
    name: z.string().trim().min(1).max(300),
    instructor: z.string().trim().max(300).nullable(),
    schedules: z.array(courseImportScheduleSchema).max(100),
  })
  .strict();

export const courseImportParseResultSchema = z
  .object({
    courses: z.array(courseImportCandidateSchema).min(1).max(200),
  })
  .strict()
  .superRefine((value, context) => {
    const names = new Set<string>();
    value.courses.forEach((course, index) => {
      if (names.has(course.name))
        context.addIssue({
          code: "custom",
          message: "Imported course names must be unique after normalization",
          path: ["courses", index, "name"],
        });
      names.add(course.name);
    });
  });

export const courseImportStartSchema = z
  .object({
    semester_id: uuidSchema,
    source_type: courseImportSourceTypeSchema,
  })
  .strict();

export const courseImportSourceSchema = z
  .object({
    file_name: z.string().trim().min(1).max(500),
    media_type: z.enum([
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/webp",
    ]),
    content_base64: z.string().min(1).max(21_000_000),
  })
  .strict();

export const courseImportResolutionSchema = z
  .object({
    incoming_course_name: z.string().trim().min(1).max(300),
    decision: z.enum(["SAME_COURSE", "NEW_COURSE"]),
    existing_course_id: uuidSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.decision === "SAME_COURSE" && !value.existing_course_id)
      context.addIssue({
        code: "custom",
        message: "Same-course resolution needs an existing Course",
        path: ["existing_course_id"],
      });
    if (value.decision === "NEW_COURSE" && value.existing_course_id)
      context.addIssue({
        code: "custom",
        message: "New-course resolution must not select an existing Course",
        path: ["existing_course_id"],
      });
  });

export type CourseImportSourceType = z.infer<
  typeof courseImportSourceTypeSchema
>;
export type CourseImportSchedule = z.infer<typeof courseImportScheduleSchema>;
export type CourseImportCandidate = z.infer<typeof courseImportCandidateSchema>;
export type CourseImportParseResult = z.infer<
  typeof courseImportParseResultSchema
>;
export type CourseImportResolution = z.infer<
  typeof courseImportResolutionSchema
>;

export type CourseImportStatus =
  "AWAITING_SOURCE" | "NEEDS_RESOLUTION" | "READY" | "COMMITTED" | "FAILED";

export interface CourseImportDuplicateCandidate {
  id: string;
  name: string;
  semester_id: string;
}

export interface CourseImportPreviewCourse extends CourseImportCandidate {
  duplicate_candidates: CourseImportDuplicateCandidate[];
  resolution: CourseImportResolution | null;
}

export interface CourseImportCommitResult {
  course_ids: string[];
  reused_existing_import: boolean;
}

export interface CourseImportJob {
  id: string;
  semester_id: string;
  source_type: CourseImportSourceType;
  status: CourseImportStatus;
  source_name: string | null;
  courses: CourseImportPreviewCourse[];
  error_message: string | null;
  result: CourseImportCommitResult | null;
  created_at: string;
  updated_at: string;
  committed_at: string | null;
}
