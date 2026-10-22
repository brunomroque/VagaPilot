import { z } from "zod"

/** Snapshot fields the extension may use locally (spec 8.4, 11.3). */
export const applicationPackagePayloadSchema = z.object({
  version: z.literal(1),
  applicationId: z.uuid(),
  jobSource: z.string(),
  company: z.string(),
  roleTitle: z.string(),
  profile: z.object({
    firstName: z.string().nullable(),
    lastName: z.string().nullable(),
    displayName: z.string(),
    email: z.string().email().nullable(),
    phone: z.string().nullable(),
    city: z.string().nullable(),
    state: z.string().nullable(),
    country: z.string().nullable(),
    linkedinUrl: z.string().nullable(),
    portfolioUrl: z.string().nullable(),
    cpf: z.string().nullable(),
    documents: z.record(z.string(), z.string()).nullable(),
  }),
  standardAnswers: z.array(
    z.object({
      key: z.string(),
      questionExamples: z.array(z.string()),
      answer: z.string(),
      proposedFrom: z
        .object({
          kind: z.enum(["standard_answer", "fact", "profile", "manual"]),
          ref: z.string().optional(),
          factIds: z.array(z.string()).optional(),
        })
        .nullable(),
    })
  ),
  facts: z.array(
    z.object({
      id: z.uuid(),
      statement: z.string(),
      kind: z.string(),
    })
  ),
  cvVersionId: z.uuid().nullable(),
  salaryInformed: z
    .object({
      amount: z.number(),
      currency: z.string(),
      regime: z.string().nullable(),
    })
    .nullable(),
})

export type ApplicationPackagePayload = z.infer<
  typeof applicationPackagePayloadSchema
>

export const PACKAGE_TTL_MS = 24 * 60 * 60 * 1000
