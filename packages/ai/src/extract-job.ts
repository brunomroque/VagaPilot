import type { RawJobPosting } from "@vagapilot/ats-adapters"
import { detectInjection } from "@vagapilot/core/guardrails"
import {
  inferSeniority,
  isLanguageLevel,
  type LanguageLevel,
  type Regime,
  type WorkModel,
} from "@vagapilot/core/job-rules"
import {
  detectTextLanguage,
  splitRequirementSections,
} from "@vagapilot/core/job-text"
import { generateText, Output } from "ai"

import { extractedJobSchema, type ExtractedJob } from "./job-schemas.js"
import { fakeObjectModel, resolveModel, type ModelOptions } from "./models.js"
import {
  EXTRACT_JOB_PROMPT_VERSION,
  EXTRACT_JOB_SYSTEM_V1,
} from "./prompts/jobs.js"

/** Upper bound of description characters sent to the model. */
export const MAX_JOB_CHARS = 30_000

export type ExtractJobResult = {
  job: ExtractedJob
  model: string
  promptVersion: string
  /** The posting tried to instruct the assistant (logged as chat.injection_blocked). */
  injectionDetected: boolean
}

function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
}

const LEVEL_WORDS: [RegExp, LanguageLevel][] = [
  [/^(basico|basic|elementary)/, "basico"],
  [/^(intermediario|intermediate)/, "intermediario"],
  [/^(avancado|advanced|upper)/, "avancado"],
  [/^(fluente|fluent|fluencia|proficient)/, "fluente"],
  [/^(nativo|native)/, "nativo"],
]

const LANGUAGE_WORDS: [RegExp, string][] = [
  [/^(ingles|english)/, "Inglês"],
  [/^(espanhol|spanish|espanol)/, "Espanhol"],
  [/^(frances|french)/, "Francês"],
  [/^(alemao|german)/, "Alemão"],
]

function levelOf(word: string): LanguageLevel | null {
  return LEVEL_WORDS.find(([pattern]) => pattern.test(word))?.[1] ?? null
}

function languageOf(word: string): string | null {
  return LANGUAGE_WORDS.find(([pattern]) => pattern.test(word))?.[1] ?? null
}

/** "Inglês avançado", "Fluent English", "inglês: fluente" → languages with level. */
export function detectRequiredLanguages(
  text: string
): ExtractedJob["languagesRequired"] {
  const words = fold(text)
    .split(/[^a-z]+/)
    .filter(Boolean)
  const found = new Map<string, LanguageLevel>()
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index] ?? ""
    const language = languageOf(word)
    if (language) {
      const level =
        levelOf(words[index + 1] ?? "") ?? levelOf(words[index - 1] ?? "")
      if (level && !found.has(language)) found.set(language, level)
    }
  }
  return [...found.entries()].map(([language, level]) => ({ language, level }))
}

function regimeOf(text: string, hint: string | null): Regime {
  const folded = fold(`${hint ?? ""}\n${text}`)
  const clt = /\b(clt|efetiv[oa]|carteira assinada)\b/.test(folded)
  const pj = /\b(pj|pessoa juridica|contractor)\b/.test(folded)
  if (clt && pj) return "ambos"
  if (clt) return "clt"
  if (pj) return "pj"
  return "nao_informado"
}

function workModelOf(text: string, hint: WorkModel | null): WorkModel | null {
  if (hint) return hint
  const folded = fold(text)
  if (/\b(hibrid[oa]|hybrid)\b/.test(folded)) return "hibrido"
  if (/\b(remot[oa]|remote|home office|100% remoto)\b/.test(folded))
    return "remoto"
  if (/\b(presencial|on-?site)\b/.test(folded)) return "presencial"
  return null
}

function periodOf(value: string | null): "mensal" | "anual" | "hora" | null {
  const folded = fold(value ?? "")
  if (/month|mes|mensal/.test(folded)) return "mensal"
  if (/year|ano|anual/.test(folded)) return "anual"
  if (/hour|hora/.test(folded)) return "hora"
  return null
}

/**
 * FAKE extraction (no LLM): structured hints from the adapter, section headings and
 * keyword rules. Deterministic; used in tests, CI and local dev without a key.
 */
export function fakeExtractJob(raw: RawJobPosting): ExtractedJob {
  const text = `${raw.title}\n${raw.location ?? ""}\n${raw.descriptionText}`
  const sections =
    raw.requirementsHint ?? splitRequirementSections(raw.descriptionText)
  return {
    company: raw.company,
    title: raw.title,
    seniority: inferSeniority(raw.title, raw.descriptionText),
    location: raw.location,
    workModel: workModelOf(text, raw.workModelHint),
    regime: regimeOf(raw.descriptionText, raw.employmentTypeHint),
    requirementsRequired: sections.required.slice(0, 25),
    requirementsPreferred: sections.preferred.slice(0, 25),
    languagesRequired: detectRequiredLanguages(raw.descriptionText),
    salary: raw.salary
      ? {
          min: raw.salary.min,
          max: raw.salary.max,
          currency: raw.salary.currency?.toUpperCase().slice(0, 3) ?? null,
          period: periodOf(raw.salary.period),
        }
      : null,
    postedAt: raw.postedAt,
    applyUrl: raw.applyUrl,
    applyEmail: raw.applyEmail,
    jobCode: raw.externalId,
    language: detectTextLanguage(raw.descriptionText || raw.title),
  }
}

function appearsIn(value: string, haystack: string): boolean {
  return fold(haystack).includes(fold(value))
}

/**
 * Normalizes a raw posting with structured output (RF4.4, P2.2). The posting goes in as
 * `<untrusted source="job_posting">`; seniority keyword rules run first and win; URLs and
 * e-mails survive only if they literally appear in the source.
 */
export async function extractJobPosting(
  raw: RawJobPosting,
  options: ModelOptions = {}
): Promise<ExtractJobResult> {
  await options.assertBillable?.()
  const description = raw.descriptionText.slice(0, MAX_JOB_CHARS)
  const seniorityHint = inferSeniority(raw.title, description)
  const { model, id } = resolveModel(
    "small",
    () => fakeObjectModel(fakeExtractJob(raw)),
    options
  )

  const payload = {
    titulo: raw.title,
    empresa: raw.company,
    local: raw.location,
    modeloInformado: raw.workModelHint,
    contrato: raw.employmentTypeHint,
    faixaSalarial: raw.salary,
    publicadaEm: raw.postedAt,
    linkCandidatura: raw.applyUrl,
    codigo: raw.externalId,
    senioridadeSugerida: seniorityHint,
    descricao: description,
  }
  const { output } = await generateText({
    model,
    output: Output.object({ schema: extractedJobSchema }),
    system: EXTRACT_JOB_SYSTEM_V1,
    prompt: `<untrusted source="job_posting">\n${JSON.stringify(payload)}\n</untrusted>`,
    temperature: 0,
    maxRetries: 1,
    abortSignal: options.abortSignal,
  })

  const sourceText = [
    raw.descriptionText,
    raw.applyUrl ?? "",
    raw.canonicalUrl,
    raw.externalApply?.url ?? "",
  ].join("\n")
  const applyUrl =
    raw.externalApply?.url ??
    (output.applyUrl && appearsIn(output.applyUrl, sourceText)
      ? output.applyUrl
      : raw.applyUrl)
  const applyEmail =
    output.applyEmail && appearsIn(output.applyEmail, raw.descriptionText)
      ? output.applyEmail.toLowerCase()
      : raw.applyEmail

  return {
    job: {
      ...output,
      title: output.title.trim() || raw.title,
      company: output.company?.trim() || raw.company,
      seniority: seniorityHint ?? output.seniority,
      workModel: raw.workModelHint ?? output.workModel,
      languagesRequired: output.languagesRequired.filter((entry) =>
        isLanguageLevel(entry.level)
      ),
      applyUrl,
      applyEmail,
      jobCode: output.jobCode ?? raw.externalId,
    },
    model: id,
    promptVersion: EXTRACT_JOB_PROMPT_VERSION,
    injectionDetected: detectInjection(raw.descriptionText),
  }
}
