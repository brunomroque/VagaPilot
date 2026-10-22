/**
 * What a classified e-mail does to the tracker (P4.3, RF11.3–RF11.7, 9.4). Pure: no I/O.
 * Automatic changes need confidence ≥ 0,8, a valid forward transition and a strong link;
 * everything else goes to the "Revise" queue. E-mail content never triggers anything else.
 */

import type { ClassifierClass } from "./email.js"
import { LINK_STRONG_SCORE, type LinkResult } from "./email-linking.js"
import {
  AUTO_APPLY_MIN_CONFIDENCE,
  checkTransition,
  statusRank,
  type ApplicationStatus,
  type TransitionRejection,
} from "./status.js"

/** Status an e-mail class points to (J5 step 3). Other classes never change status. */
export function statusForEmailClass(
  value: ClassifierClass
): ApplicationStatus | null {
  switch (value) {
    case "confirmacao":
      return "enviada"
    case "reprovacao":
      return "reprovada"
    case "teste_etapa":
      return "etapa_pendente"
    case "convite_entrevista":
      return "entrevista"
    case "recrutador_contato":
    case "vaga_alerta":
    case "irrelevante":
    case "codigo_verificacao":
      return null
    default: {
      const unreachable: never = value
      throw new Error(`Unknown e-mail class: ${String(unreachable)}`)
    }
  }
}

/** Next action written with a deadline or interview time (RF11.5). Stored text, pt-BR. */
export function nextActionForEmailClass(value: ClassifierClass): string | null {
  switch (value) {
    case "teste_etapa":
      return "Concluir teste ou etapa do processo"
    case "convite_entrevista":
      return "Entrevista agendada"
    case "confirmacao":
    case "reprovacao":
    case "recrutador_contato":
    case "vaga_alerta":
    case "irrelevante":
    case "codigo_verificacao":
      return null
    default: {
      const unreachable: never = value
      throw new Error(`Unknown e-mail class: ${String(unreachable)}`)
    }
  }
}

export type ReviewReason =
  | TransitionRejection
  | "ambiguous_link"
  | "weak_link"
  | "no_application"
  | "created_from_email"

export const REVIEW_REASONS = [
  "same_status",
  "not_allowed",
  "terminal_requires_user",
  "regression",
  "missing_evidence",
  "needs_review",
  "ambiguous_link",
  "weak_link",
  "no_application",
  "created_from_email",
] as const satisfies readonly ReviewReason[]

export type EmailDecision =
  | {
      kind: "skip"
      reason:
        "irrelevant" | "verification_code" | "job_alert" | "no_application"
    }
  /** Linked without a status change (recruiter contact, same status, confirmation already true). */
  | { kind: "link"; applicationId: string }
  | {
      kind: "apply"
      applicationId: string
      from: ApplicationStatus
      to: ApplicationStatus
    }
  | {
      kind: "review"
      applicationId: string | null
      suggestedStatus: ApplicationStatus | null
      reason: ReviewReason
    }
  /** RF11.7: confirmation of an application made outside the app. */
  | { kind: "create"; status: "enviada" }

export type EmailDecisionInput = {
  classification: ClassifierClass
  confidence: number
  link: LinkResult
  /** Current status of `link.applicationId`, when linked. */
  currentStatus: ApplicationStatus | null
  /** The classifier found the company name (needed to create an application). */
  hasCompany: boolean
}

export function decideEmailOutcome(input: EmailDecisionInput): EmailDecision {
  const { classification, confidence, link } = input
  switch (classification) {
    case "codigo_verificacao":
      return { kind: "skip", reason: "verification_code" }
    case "vaga_alerta":
      return { kind: "skip", reason: "job_alert" }
    case "irrelevante":
      return { kind: "skip", reason: "irrelevant" }
    case "confirmacao":
    case "reprovacao":
    case "teste_etapa":
    case "convite_entrevista":
    case "recrutador_contato":
      break
    default: {
      const unreachable: never = classification
      throw new Error(`Unknown e-mail class: ${String(unreachable)}`)
    }
  }

  const target = statusForEmailClass(classification)
  const applicationId = link.applicationId
  const current = input.currentStatus

  if (!applicationId || !current) {
    if (link.ambiguous) {
      return {
        kind: "review",
        applicationId: link.candidates[0]?.applicationId ?? null,
        suggestedStatus: target,
        reason: "ambiguous_link",
      }
    }
    if (!target) return { kind: "skip", reason: "no_application" }
    if (
      classification === "confirmacao" &&
      confidence >= AUTO_APPLY_MIN_CONFIDENCE &&
      input.hasCompany
    ) {
      return { kind: "create", status: "enviada" }
    }
    return {
      kind: "review",
      applicationId: null,
      suggestedStatus: target,
      reason: "no_application",
    }
  }

  if (!target || target === current) return { kind: "link", applicationId }
  // A late "we received your application" adds nothing once the process moved on.
  if (
    classification === "confirmacao" &&
    statusRank(current) >= statusRank("enviada")
  ) {
    return { kind: "link", applicationId }
  }

  const check = checkTransition(current, target, {
    source: "gmail",
    confidence,
    hasEvidence: true,
  })
  if (!check.ok) {
    return {
      kind: "review",
      applicationId,
      suggestedStatus: target,
      reason: check.reason,
    }
  }
  if (link.score < LINK_STRONG_SCORE) {
    return {
      kind: "review",
      applicationId,
      suggestedStatus: target,
      reason: "weak_link",
    }
  }
  return { kind: "apply", applicationId, from: current, to: target }
}

/** Deadlines and interview times are written only with confident, non-review outcomes. */
export function shouldWriteNextAction(
  decision: EmailDecision,
  confidence: number
): boolean {
  switch (decision.kind) {
    case "apply":
    case "link":
      return confidence >= AUTO_APPLY_MIN_CONFIDENCE
    case "review":
    case "create":
    case "skip":
      return false
    default: {
      const unreachable: never = decision
      throw new Error(`Unknown decision: ${String(unreachable)}`)
    }
  }
}
