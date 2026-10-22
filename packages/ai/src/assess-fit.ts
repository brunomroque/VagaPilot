import { normalizeForGrounding } from "@vagapilot/core/facts"
import {
  capFitByRubric,
  fitFromRubric,
  isBlockingAlert,
  mergeAlerts,
  type FitLevelValue,
  type JobAlert,
  type JobLanguage,
} from "@vagapilot/core/job-rules"
import { generateText, Output } from "ai"

import { fitAssessmentSchema, type FitAssessment } from "./job-schemas.js"
import { fakeObjectModel, resolveModel, type ModelOptions } from "./models.js"
import {
  ASSESS_FIT_PROMPT_VERSION,
  ASSESS_FIT_SYSTEM_V1,
} from "./prompts/jobs.js"

export type FitFact = {
  id: string
  statement: string
  kind: string
  tags: readonly string[]
}

export type FitInput = {
  job: {
    title: string
    company: string | null
    requirementsRequired: readonly string[]
    requirementsPreferred: readonly string[]
    language: JobLanguage
  }
  /** Confirmed facts only (retrieved by search_facts). Anything else is rejected. */
  facts: readonly FitFact[]
  /** Code-computed alerts (10.5): the model cannot remove them. */
  codeAlerts: readonly JobAlert[]
  tracks: readonly { id: string; name: string; keywords: readonly string[] }[]
}

export type FitResult = {
  assessment: FitAssessment
  /** Reasons dropped because they cited unknown or unconfirmed facts (P2.3). */
  droppedReasons: number
  model: string
  promptVersion: string
}

const STOPWORDS = new Set([
  "com",
  "para",
  "de",
  "da",
  "do",
  "das",
  "dos",
  "em",
  "uma",
  "um",
  "the",
  "and",
  "with",
  "for",
  "experiencia",
  "experience",
  "years",
  "anos",
  "conhecimento",
  "producao",
  "production",
  "times",
  "time",
  "ou",
  "or",
  "of",
  "in",
  "e",
])

function tokens(text: string): Set<string> {
  return new Set(
    normalizeForGrounding(text)
      .split(/[^a-z0-9+#/.]+/)
      .map((token) => token.replace(/[./]+$/, ""))
      .filter((token) => token.length >= 3 && !STOPWORDS.has(token))
  )
}

function coveringFacts(
  requirement: string,
  facts: readonly FitFact[]
): FitFact[] {
  const wanted = tokens(requirement)
  if (wanted.size === 0) return []
  return facts.filter((fact) => {
    const have = tokens(`${fact.statement} ${fact.tags.join(" ")}`)
    for (const token of wanted) if (have.has(token)) return true
    return false
  })
}

const SCORE_BANDS: Record<FitLevelValue, [number, number]> = {
  alto: [70, 100],
  medio: [40, 69],
  baixo: [0, 39],
}

function clampToBand(score: number, fit: FitLevelValue): number {
  const [min, max] = SCORE_BANDS[fit]
  return Math.min(max, Math.max(min, Math.round(score)))
}

/** FAKE fit (no LLM): lexical coverage of requirements by confirmed facts + the rubric. */
export function fakeAssessFit(input: FitInput): FitAssessment {
  const reasons: FitAssessment["reasons"] = []
  const gaps: FitAssessment["gaps"] = []
  let covered = 0
  let coveredPreferred = 0
  for (const requirement of input.job.requirementsRequired) {
    const facts = coveringFacts(requirement, input.facts)
    if (facts.length === 0) {
      gaps.push({
        requirement,
        severity: "obrigatorio",
        note: "Nenhum fato confirmado cobre este requisito.",
      })
      continue
    }
    covered += 1
    if (reasons.length < 5) {
      reasons.push({
        text: `${requirement}: ${facts[0]?.statement ?? ""}`.slice(0, 400),
        requirement,
        factIds: facts.slice(0, 3).map((fact) => fact.id),
      })
    }
  }
  for (const requirement of input.job.requirementsPreferred) {
    const facts = coveringFacts(requirement, input.facts)
    if (facts.length > 0) {
      coveredPreferred += 1
      if (reasons.length < 5) {
        reasons.push({
          text: `${requirement}: ${facts[0]?.statement ?? ""}`.slice(0, 400),
          requirement,
          factIds: facts.slice(0, 3).map((fact) => fact.id),
        })
      }
    } else {
      gaps.push({
        requirement,
        severity: "desejavel",
        note: "Diferencial sem fato confirmado.",
      })
    }
  }
  const required = input.job.requirementsRequired.length
  const preferred = input.job.requirementsPreferred.length
  const denominator = required + preferred * 0.5
  const blocking = input.codeAlerts.filter((alert) =>
    isBlockingAlert(alert.code)
  ).length
  const raw =
    denominator === 0
      ? 50
      : (100 * (covered + coveredPreferred * 0.5)) / denominator
  const fit = fitFromRubric({
    uncoveredRequired: required - covered,
    alerts: input.codeAlerts,
  })
  const requirementTokens = tokens(
    [
      ...input.job.requirementsRequired,
      ...input.job.requirementsPreferred,
      input.job.title,
    ].join(" ")
  )
  let bestTrack: { id: string; overlap: number } | null = null
  for (const track of input.tracks) {
    const trackTokens = tokens(`${track.name} ${track.keywords.join(" ")}`)
    let overlap = 0
    for (const token of trackTokens)
      if (requirementTokens.has(token)) overlap += 1
    if (overlap > (bestTrack?.overlap ?? 0))
      bestTrack = { id: track.id, overlap }
  }
  return {
    fit,
    score: clampToBand(raw - blocking * 10, fit),
    reasons,
    gaps,
    alerts: input.codeAlerts.map((alert) => ({
      code: alert.code,
      message: alert.message,
    })),
    recommendedTrackId: bestTrack?.id ?? null,
    recommendedLanguage: input.job.language,
  }
}

/**
 * `assessFit` (10.5, F6, P2.3). After generation: reasons must cite only the confirmed facts
 * given (invalid ones are dropped), code alerts are merged back and the level is capped by
 * the rubric computed from the remaining gaps and alerts.
 */
export async function assessFit(
  input: FitInput,
  options: ModelOptions = {}
): Promise<FitResult> {
  await options.assertBillable?.()
  const { model, id } = resolveModel(
    "large",
    () => fakeObjectModel(fakeAssessFit(input)),
    options
  )
  const payload = {
    vaga: {
      titulo: input.job.title,
      empresa: input.job.company,
      obrigatorios: input.job.requirementsRequired,
      desejaveis: input.job.requirementsPreferred,
      idioma: input.job.language,
    },
    fatosConfirmados: input.facts.map((fact) => ({
      id: fact.id,
      texto: fact.statement,
      tipo: fact.kind,
    })),
    alertasDoSistema: input.codeAlerts.map((alert) => ({
      code: alert.code,
      message: alert.message,
    })),
    trilhas: input.tracks.map((track) => ({
      id: track.id,
      nome: track.name,
      palavras: track.keywords,
    })),
  }
  const { output } = await generateText({
    model,
    output: Output.object({ schema: fitAssessmentSchema }),
    system: ASSESS_FIT_SYSTEM_V1,
    prompt: `<untrusted source="job_posting">\n${JSON.stringify(payload)}\n</untrusted>`,
    temperature: 0,
    maxRetries: 1,
    abortSignal: options.abortSignal,
  })

  const allowed = new Set(input.facts.map((fact) => fact.id))
  const validReasons = output.reasons.filter(
    (reason) =>
      reason.factIds.length > 0 &&
      reason.factIds.every((factId) => allowed.has(factId))
  )
  const droppedReasons = output.reasons.length - validReasons.length

  const alerts = mergeAlerts(
    input.codeAlerts,
    output.alerts.map((alert) => ({ code: alert.code, message: alert.message }))
  )
  const uncoveredRequired = output.gaps.filter(
    (gap) => gap.severity === "obrigatorio"
  ).length
  const fit = capFitByRubric(
    output.fit,
    fitFromRubric({ uncoveredRequired, alerts })
  )
  const trackIds = new Set(input.tracks.map((track) => track.id))

  return {
    assessment: {
      fit,
      score: clampToBand(output.score, fit),
      reasons: validReasons.slice(0, 5),
      gaps: output.gaps,
      alerts: alerts.map((alert) => ({
        code: alert.code,
        message: alert.message,
      })),
      recommendedTrackId:
        output.recommendedTrackId && trackIds.has(output.recommendedTrackId)
          ? output.recommendedTrackId
          : null,
      recommendedLanguage: input.job.language,
    },
    droppedReasons,
    model: id,
    promptVersion: ASSESS_FIT_PROMPT_VERSION,
  }
}
