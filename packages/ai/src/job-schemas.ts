import {
  ALERT_CODES,
  JOB_LANGUAGES,
  LANGUAGE_LEVEL_VALUES,
  REGIME_VALUES,
  SENIORITY_LEVELS,
  WORK_MODEL_VALUES,
} from "@vagapilot/core/job-rules"
import { z } from "zod"

/** Structured job (RF4.4): what `extractJobPosting` returns for the database and the fit. */
export const extractedJobSchema = z.object({
  company: z.string().max(200).nullable(),
  title: z.string().min(1).max(200),
  seniority: z.enum(SENIORITY_LEVELS).nullable(),
  location: z.string().max(200).nullable(),
  workModel: z.enum(WORK_MODEL_VALUES).nullable(),
  regime: z.enum(REGIME_VALUES),
  requirementsRequired: z.array(z.string().min(2).max(300)).max(25),
  requirementsPreferred: z.array(z.string().min(2).max(300)).max(25),
  languagesRequired: z
    .array(
      z.object({
        language: z.string().min(2).max(40),
        level: z.enum(LANGUAGE_LEVEL_VALUES),
      })
    )
    .max(5),
  salary: z
    .object({
      min: z.number().nonnegative().nullable(),
      max: z.number().nonnegative().nullable(),
      currency: z.string().length(3).nullable(),
      period: z.enum(["mensal", "anual", "hora"]).nullable(),
    })
    .nullable(),
  postedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  applyUrl: z.string().max(2000).nullable(),
  applyEmail: z.string().max(254).nullable(),
  jobCode: z.string().max(80).nullable(),
  language: z.enum(JOB_LANGUAGES),
})
export type ExtractedJob = z.infer<typeof extractedJobSchema>

/** `FitAssessment` exactly as in spec 10.5. */
export const fitAssessmentSchema = z.object({
  fit: z.enum(["alto", "medio", "baixo"]),
  score: z.number().int().min(0).max(100),
  reasons: z
    .array(
      z.object({
        text: z.string().min(1).max(400),
        requirement: z.string().max(300).optional(),
        factIds: z.array(z.uuid()).min(1),
      })
    )
    .max(5),
  gaps: z.array(
    z.object({
      requirement: z.string().min(1).max(300),
      severity: z.enum(["obrigatorio", "desejavel"]),
      note: z.string().max(300),
    })
  ),
  alerts: z.array(
    z.object({ code: z.enum(ALERT_CODES), message: z.string().max(300) })
  ),
  recommendedTrackId: z.uuid().nullable(),
  recommendedLanguage: z.enum(JOB_LANGUAGES),
})
export type FitAssessment = z.infer<typeof fitAssessmentSchema>

/**
 * What the model is asked for: same shape without bounds/formats. Production (24/10): with a
 * real profile the strict schema (uuid factIds, max lengths) failed validation and every link
 * ended as `falhou/internal`. `assessFit` clamps and re-validates after the call.
 */
export const fitAssessmentModelSchema = z.object({
  fit: z.enum(["alto", "medio", "baixo"]),
  score: z.number(),
  reasons: z.array(
    z.object({
      text: z.string(),
      requirement: z.string().nullish(),
      factIds: z.array(z.string()),
    })
  ),
  gaps: z.array(
    z.object({
      requirement: z.string(),
      severity: z.enum(["obrigatorio", "desejavel"]),
      note: z.string(),
    })
  ),
  alerts: z.array(z.object({ code: z.string(), message: z.string() })),
  recommendedTrackId: z.string().nullable(),
})
