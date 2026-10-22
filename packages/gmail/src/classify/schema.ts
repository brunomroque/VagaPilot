import { CLASSIFIER_CLASSES } from "@vagapilot/core/email"
import { z } from "zod"

/**
 * `classifyEmail` output (10.5): class, confidence, company?, role?, deadline? (ISO-8601 with
 * offset), interviewAt?, link?, reasoning_short. Optional fields are nullable for structured
 * outputs. There is no field for actions: the classifier can only describe the e-mail.
 */
export const emailClassificationSchema = z.object({
  class: z.enum(CLASSIFIER_CLASSES),
  confidence: z.number().min(0).max(1),
  company: z.string().max(200).nullable(),
  role: z.string().max(200).nullable(),
  deadline: z.string().max(40).nullable(),
  interviewAt: z.string().max(40).nullable(),
  link: z.string().max(500).nullable(),
  reasoning_short: z.string().max(300),
})

export type EmailClassificationOutput = z.infer<
  typeof emailClassificationSchema
>
