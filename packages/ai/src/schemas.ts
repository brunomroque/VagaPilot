import { FACT_KINDS } from "@vagapilot/core/facts"
import { z } from "zod"

/** Experience as it appears in the CV. Never written to the profile without user action. */
export const cvExperienceSchema = z.object({
  company: z.string().min(1).max(200),
  title: z.string().min(1).max(200),
  /** `YYYY-MM` when the CV states it. */
  startMonth: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .nullable(),
  endMonth: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .nullable(),
  isCurrent: z.boolean(),
  excerpt: z.string().min(3).max(500),
})

export const cvFactSchema = z.object({
  statement: z.string().min(2).max(500),
  kind: z.enum(FACT_KINDS),
  tags: z.array(z.string().min(1).max(60)).max(10),
  /** Company of the related experience, exactly as in `experiences[].company`, or null. */
  experienceHint: z.string().max(200).nullable(),
  /** Verbatim passage of the CV that supports the statement. */
  excerpt: z.string().min(2).max(500),
})

export const cvExtractionSchema = z.object({
  experiences: z.array(cvExperienceSchema).max(30),
  facts: z.array(cvFactSchema).max(120),
})

/**
 * Schema sent to the model. Gemini rejects response schemas with many bounds/regexes ("too many
 * states for serving"), so the model gets a plain shape and `cvExtractionSchema` items are
 * enforced in code afterwards.
 */
export const cvExtractionModelSchema = z.object({
  experiences: z.array(
    z.object({
      company: z.string(),
      title: z.string(),
      startMonth: z.string().nullable().describe("YYYY-MM ou null"),
      endMonth: z.string().nullable().describe("YYYY-MM ou null"),
      isCurrent: z.boolean(),
      excerpt: z.string(),
    })
  ),
  facts: z.array(
    z.object({
      statement: z.string(),
      kind: z.enum(FACT_KINDS),
      tags: z.array(z.string()),
      experienceHint: z.string().nullable(),
      excerpt: z.string(),
    })
  ),
})

export type CvExperience = z.infer<typeof cvExperienceSchema>
export type CvFact = z.infer<typeof cvFactSchema>
export type CvExtraction = z.infer<typeof cvExtractionSchema>
