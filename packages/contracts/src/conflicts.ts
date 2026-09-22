import { z } from "zod";

const explicitValueSchema = z
  .object({ value: z.unknown() })
  .strict()
  .refine((input) => Object.hasOwn(input, "value"), {
    message: "An explicit value is required",
  });

export const conflictResolutionSchema = z
  .object({
    strategy: z.enum(["USE_LOCAL", "USE_REMOTE", "USE_EXPLICIT_VALUE"]),
    field_resolutions: z.record(
      z.string(),
      z.union([z.literal("LOCAL"), z.literal("REMOTE"), explicitValueSchema]),
    ),
  })
  .strict()
  .superRefine((input, context) => {
    if (
      input.strategy === "USE_LOCAL" &&
      Object.values(input.field_resolutions).some((value) => value !== "LOCAL")
    )
      context.addIssue({
        code: "custom",
        message: "USE_LOCAL requires local values for every field",
      });
    if (
      input.strategy === "USE_REMOTE" &&
      Object.values(input.field_resolutions).some((value) => value !== "REMOTE")
    )
      context.addIssue({
        code: "custom",
        message: "USE_REMOTE requires remote values for every field",
      });
  });

export type ConflictResolution = z.infer<typeof conflictResolutionSchema>;
