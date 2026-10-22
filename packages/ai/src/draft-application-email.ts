import { generateText, Output } from "ai"
import { z } from "zod"

import {
  countWords,
  jobPostingAsksSalary,
  MAX_DRAFT_WORDS,
  validateApplicationEmailDraft,
} from "@vagapilot/core/application-email"

import { fakeObjectModel, resolveModel, type ModelOptions } from "./models.js"

export const DRAFT_EMAIL_PROMPT_VERSION = "draft-email.v1"

const draftSchema = z.object({
  subject: z.string().min(3).max(200),
  bodyMd: z.string().min(20).max(4000),
})

export type DraftApplicationEmailInput = {
  candidateName: string
  roleTitle: string
  company: string
  jobDescription: string
  includeSalaryWhenAsked: boolean
  /** Facts / standard answers already confirmed — grounding only. */
  groundingBullets: string[]
}

export type DraftApplicationEmailResult = {
  subject: string
  bodyMd: string
  jobAsksSalary: boolean
  model: string
  promptVersion: string
}

function fakeDraft(
  input: DraftApplicationEmailInput
): z.infer<typeof draftSchema> {
  return {
    subject: `Candidatura — ${input.roleTitle} (${input.company})`,
    bodyMd: [
      `Olá,`,
      ``,
      `Tenho interesse na vaga de ${input.roleTitle} na ${input.company}.`,
      input.groundingBullets[0] ? `${input.groundingBullets[0]}.` : "",
      `Fico à disposição para conversarmos.`,
      ``,
      `Atenciosamente,`,
      input.candidateName,
    ]
      .filter(Boolean)
      .join("\n"),
  }
}

/**
 * RF9 / P6.1: structured draft only; salary omitted unless the posting asks and the user allows it.
 */
export async function draftApplicationEmail(
  input: DraftApplicationEmailInput,
  options: ModelOptions = {}
): Promise<DraftApplicationEmailResult> {
  const jobAsksSalary = jobPostingAsksSalary(input.jobDescription)
  const { model, id } = resolveModel(
    "large",
    () => fakeObjectModel(fakeDraft(input)),
    options
  )

  const salaryRule =
    jobAsksSalary && input.includeSalaryWhenAsked
      ? "Se a vaga pedir pretensão, cite apenas faixas já confirmadas pelo candidato."
      : "Não mencione valores monetários, salário ou pretensão."

  const { output } = await generateText({
    model,
    output: Output.object({ schema: draftSchema }),
    system: [
      "Redator de e-mail de candidatura em pt-BR.",
      `Máximo ${MAX_DRAFT_WORDS} palavras.`,
      "Use só fatos fornecidos; não invente experiência.",
      salaryRule,
      "Tom profissional e direto.",
    ].join(" "),
    prompt: JSON.stringify({
      candidato: input.candidateName,
      vaga: input.roleTitle,
      empresa: input.company,
      descricao: input.jobDescription.slice(0, 6000),
      fatos: input.groundingBullets.slice(0, 8),
    }),
    temperature: 0.2,
    maxRetries: 1,
    abortSignal: options.abortSignal,
  })

  const validation = validateApplicationEmailDraft({
    body: output.bodyMd,
    jobAsksSalary,
    includeSalaryWhenAsked: input.includeSalaryWhenAsked,
  })
  if (!validation.ok) {
    throw new Error(`draft_invalid:${validation.code}`)
  }
  if (countWords(output.bodyMd) > MAX_DRAFT_WORDS) {
    throw new Error("draft_invalid:too_long")
  }

  return {
    subject: output.subject,
    bodyMd: output.bodyMd,
    jobAsksSalary,
    model: id,
    promptVersion: DRAFT_EMAIL_PROMPT_VERSION,
  }
}
