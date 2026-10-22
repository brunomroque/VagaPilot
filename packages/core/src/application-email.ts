/**
 * Application e-mail draft rules (F9, P6.1, eval email-draft): ≤150 words, no salary unless allowed.
 */

import { createHash } from "node:crypto"

export const MAX_DRAFT_WORDS = 150

const MONEY_RE =
  /(?:R\$\s?\d[\d.,]*|\d[\d.,]*\s?(?:reais|mil|k\b)|sal[aá]rio\s*(?:de|:)?\s*\d|pretens[aã]o\s*(?:de|:)?\s*\d|\$\s?\d[\d.,]*)/i

export function countWords(text: string): number {
  const trimmed = text.trim()
  if (!trimmed) return 0
  return trimmed.split(/\s+/).length
}

export type DraftValidationInput = {
  body: string
  /** Vaga pede faixa ou pretensão explícita. */
  jobAsksSalary: boolean
  /** Preferência `email.include_salary` (default true when a vaga pedir). */
  includeSalaryWhenAsked: boolean
}

export type DraftValidationResult =
  | { ok: true }
  | { ok: false; code: "too_long" | "salary_not_allowed"; words?: number }

export function validateApplicationEmailDraft(
  input: DraftValidationInput
): DraftValidationResult {
  const words = countWords(input.body)
  if (words > MAX_DRAFT_WORDS) {
    return { ok: false, code: "too_long", words }
  }
  const mayIncludeSalary = input.jobAsksSalary && input.includeSalaryWhenAsked
  if (!mayIncludeSalary && MONEY_RE.test(input.body)) {
    return { ok: false, code: "salary_not_allowed" }
  }
  return { ok: true }
}

export type EmailDraftSnapshot = {
  to: string[]
  cc: string[]
  subject: string
  bodyMd: string
  attachmentCvVersionId: string | null
}

/** Stable hash for approvals (10.1): content comes from the database, not the LLM at send time. */
export function hashEmailDraftSnapshot(snapshot: EmailDraftSnapshot): string {
  const payload = {
    to: [...snapshot.to].sort(),
    cc: [...snapshot.cc].sort(),
    subject: snapshot.subject,
    bodyMd: snapshot.bodyMd,
    attachmentCvVersionId: snapshot.attachmentCvVersionId,
  }
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex")
}

/** Heuristic: vaga menciona salário, pretensão ou faixa. */
export function jobPostingAsksSalary(text: string): boolean {
  const folded = text.toLowerCase()
  return (
    /sal[aá]rio|pretens[aã]o|remunera|faixa\s+salar|compensa|benef[ií]cios\s+e\s+sal/.test(
      folded
    ) || /salary|compensation|pay\s+range/.test(folded)
  )
}
