import { getAiConfig, realLanguageModel, type AiConfig } from "@vagapilot/ai"
import { parseUserDate } from "@vagapilot/core/dates"
import { type ClassifierClass } from "@vagapilot/core/email"
import {
  parseDeadline,
  parseInterviewTime,
  parseIsoWithOffset,
} from "@vagapilot/core/email-dates"
import { generateText, Output, type LanguageModel } from "ai"

import {
  createFakeClassifierModel,
  FAKE_CLASSIFIER_MODEL_ID,
  type ClassifierInput,
} from "./fake.js"
import {
  CLASSIFY_EMAIL_PROMPT_VERSION,
  CLASSIFY_EMAIL_SYSTEM_V1,
} from "./prompt.js"
import { emailClassificationSchema } from "./schema.js"

/** Body characters sent to the model. The body is never stored nor logged (CA11.4). */
export const MAX_EMAIL_CHARS = 6_000

export type EmailClassification = {
  class: ClassifierClass
  confidence: number
  company: string | null
  role: string | null
  deadline: Date | null
  interviewAt: Date | null
  link: string | null
  model: string
  promptVersion: string
}

export type ClassifyEmailOptions = {
  model?: LanguageModel
  config?: AiConfig
  abortSignal?: AbortSignal
}

function resolveModel(input: ClassifierInput, options: ClassifyEmailOptions) {
  if (options.model) {
    const id =
      typeof options.model === "string" ? options.model : options.model.modelId
    return { model: options.model, id }
  }
  const config = options.config ?? getAiConfig()
  switch (config.mode) {
    case "fake":
      return {
        model: createFakeClassifierModel(input),
        id: FAKE_CLASSIFIER_MODEL_ID,
      }
    case "gateway":
    case "google":
      return {
        model: realLanguageModel(config, config.extractionModel),
        id: config.extractionModel,
      }
    default: {
      const unreachable: never = config.mode
      throw new Error(`Unhandled AI provider mode: ${String(unreachable)}`)
    }
  }
}

/** Keeps the delimiter intact whatever the e-mail contains (10.4). */
export function untrustedEmailBlock(input: ClassifierInput): string {
  const escape = (value: string) =>
    value.replace(/<\/?\s*untrusted/gi, "‹untrusted")
  return [
    '<untrusted source="email">',
    `De: ${escape(input.fromName ?? "")} <${escape(input.fromAddress ?? "")}>`,
    `Assunto: ${escape(input.subject)}`,
    `Recebido em: ${input.receivedAt.toISOString()}`,
    "",
    escape(input.body.slice(0, MAX_EMAIL_CHARS)),
    "</untrusted>",
  ].join("\n")
}

function cleanText(value: string | null, max: number): string | null {
  const clean = value?.replace(/\s+/g, " ").trim()
  return clean ? clean.slice(0, max) : null
}

/** Only links copied from the e-mail itself, over http(s). */
function verifiedLink(
  link: string | null,
  input: ClassifierInput
): string | null {
  if (!link) return null
  try {
    const url = new URL(link)
    if (url.protocol !== "https:" && url.protocol !== "http:") return null
  } catch {
    return null
  }
  return input.body.includes(link) || input.subject.includes(link) ? link : null
}

function modelDate(value: string | null): Date | null {
  return parseIsoWithOffset(value) ?? (value ? parseUserDate(value) : null)
}

/**
 * classifyEmail (P4.2, schema 10.5). Small model, content inside `<untrusted>`, output validated
 * with Zod. Deadlines without an offset are read in America/Sao_Paulo; a missing deadline of a
 * test e-mail falls back to the deterministic parser (CA11.2).
 */
export async function classifyEmail(
  input: ClassifierInput,
  options: ClassifyEmailOptions = {}
): Promise<EmailClassification> {
  const { model, id } = resolveModel(input, options)
  const companies = (input.knownCompanies ?? []).slice(0, 30)
  const { output } = await generateText({
    model,
    output: Output.object({ schema: emailClassificationSchema }),
    system: CLASSIFY_EMAIL_SYSTEM_V1,
    prompt: [
      companies.length > 0
        ? `Empresas com candidatura da pessoa (apenas para reconhecer nomes): ${companies.join("; ")}`
        : "",
      untrustedEmailBlock(input),
    ]
      .filter(Boolean)
      .join("\n\n"),
    temperature: 0,
    maxRetries: 1,
    abortSignal: options.abortSignal,
  })

  const text = `${input.subject}\n${input.body}`
  let deadline = modelDate(output.deadline)
  if (!deadline && output.class === "teste_etapa") {
    deadline = parseDeadline(text, input.receivedAt, { fallbackToFirst: true })
  }
  let interviewAt = modelDate(output.interviewAt)
  if (!interviewAt && output.class === "convite_entrevista") {
    interviewAt = parseInterviewTime(text, input.receivedAt)
  }

  return {
    class: output.class,
    confidence:
      Math.round(Math.min(1, Math.max(0, output.confidence)) * 100) / 100,
    company: cleanText(output.company, 200),
    role: cleanText(output.role, 200),
    deadline,
    interviewAt,
    link: verifiedLink(output.link, input),
    model: id,
    promptVersion: CLASSIFY_EMAIL_PROMPT_VERSION,
  }
}
