import { z } from "zod";

export const interpretationRequestSchema = z
  .object({
    raw_capture_id: z.string().uuid(),
    context: z
      .object({
        candidate_course_ids: z.array(z.string().uuid()).max(20),
        current_course_id: z.string().uuid().nullable(),
        current_semester_id: z.string().uuid().nullable(),
      })
      .strict(),
  })
  .strict();

export const interpretationSchema = z
  .object({
    classification: z.enum([
      "ITEM",
      "COURSE_INFORMATION",
      "AMBIGUOUS",
      "MULTI_ITEM_CANDIDATE",
    ]),
    title: z.string().max(500).nullable(),
    detail: z.string().max(20000).nullable(),
    course_candidate: z.string().max(300).nullable(),
    start_at: z.string().datetime({ offset: true }).nullable(),
    occurrence_start_at: z.string().datetime({ offset: true }).nullable(),
    occurrence_end_at: z.string().datetime({ offset: true }).nullable(),
    due_at: z.string().datetime({ offset: true }).nullable(),
    course_information: z.string().max(20000).nullable(),
    split_candidates: z.array(z.string().min(1).max(500)).max(20),
    confidence: z.number().min(0).max(1),
    uncertainty: z.string().max(2000).nullable(),
  })
  .strict();

export type CaptureInterpretation = z.infer<typeof interpretationSchema>;
export type InterpretationRequest = z.infer<typeof interpretationRequestSchema>;
