/**
 * Plan limits and usage checks (spec §14, P6.3). Pure: no I/O.
 * Limits are enforced in the backend before billable LLM calls.
 */

export const PLAN_IDS = ["free", "pro", "executive", "search_pass"] as const
export type PlanId = (typeof PLAN_IDS)[number]

export type PlanFeatures = {
  gmail: boolean
  emailApplications: boolean
  trackerExport: boolean
  extension: boolean
}

export type PlanFeatureKey = keyof PlanFeatures

export type PlanLimits = PlanFeatures & {
  jobAnalysesPerMonth: number | null
  assistedApplicationsPerMonth: number
  cvTracksMax: number
  cvVersionsMax: number
  extensionFillsPerDay: number | null
  emailsPerDay: number
  /** Daily LLM spend ceiling in centavos de BRL (F14 teto de custo). */
  dailyLlmCostCeilingCents: number
}

export const USAGE_METRICS = [
  "job_analyses",
  "assisted_applications",
  "emails_sent",
  "extension_fills",
  "llm_cost_cents",
] as const
export type UsageMetric = (typeof USAGE_METRICS)[number]

export type UsageIncrementResult =
  | { ok: true; newValue: number }
  | { ok: false; code: "limit_exceeded" | "feature_denied"; limit?: number }

/** §14 — Grátis, Pro, Executivo, Passe de busca. */
export function limitsForPlan(plan: PlanId): PlanLimits {
  switch (plan) {
    case "free":
      return {
        jobAnalysesPerMonth: 15,
        assistedApplicationsPerMonth: 5,
        cvTracksMax: 1,
        cvVersionsMax: 3,
        gmail: false,
        emailApplications: false,
        trackerExport: false,
        extension: true,
        extensionFillsPerDay: 5,
        emailsPerDay: 0,
        dailyLlmCostCeilingCents: 150,
      }
    case "pro":
      return {
        jobAnalysesPerMonth: 200,
        assistedApplicationsPerMonth: 200,
        cvTracksMax: 6,
        cvVersionsMax: 6,
        gmail: true,
        emailApplications: true,
        trackerExport: true,
        extension: true,
        extensionFillsPerDay: 25,
        emailsPerDay: 10,
        dailyLlmCostCeilingCents: 800,
      }
    case "executive":
    case "search_pass":
      return {
        jobAnalysesPerMonth: null,
        assistedApplicationsPerMonth: 500,
        cvTracksMax: 12,
        cvVersionsMax: 12,
        gmail: true,
        emailApplications: true,
        trackerExport: true,
        extension: true,
        extensionFillsPerDay: null,
        emailsPerDay: 10,
        dailyLlmCostCeilingCents: 2_500,
      }
    default: {
      const unreachable: never = plan
      throw new Error(`Unknown plan: ${String(unreachable)}`)
    }
  }
}

export function isPlanId(value: unknown): value is PlanId {
  return (
    typeof value === "string" && (PLAN_IDS as readonly string[]).includes(value)
  )
}

/** `YYYY-MM` for monthly counters; `YYYY-MM-DD` for daily ones. */
export function usagePeriod(metric: UsageMetric, at: Date): string {
  const year = at.getUTCFullYear()
  const month = String(at.getUTCMonth() + 1).padStart(2, "0")
  if (
    metric === "llm_cost_cents" ||
    metric === "emails_sent" ||
    metric === "extension_fills"
  ) {
    const day = String(at.getUTCDate()).padStart(2, "0")
    return `${year}-${month}-${day}`
  }
  return `${year}-${month}`
}

function limitForMetric(plan: PlanId, metric: UsageMetric): number | null {
  const limits = limitsForPlan(plan)
  switch (metric) {
    case "job_analyses":
      return limits.jobAnalysesPerMonth
    case "assisted_applications":
      return limits.assistedApplicationsPerMonth
    case "emails_sent":
      return limits.emailsPerDay
    case "extension_fills":
      return limits.extensionFillsPerDay
    case "llm_cost_cents":
      return limits.dailyLlmCostCeilingCents
    default: {
      const unreachable: never = metric
      throw new Error(`Unknown metric: ${String(unreachable)}`)
    }
  }
}

/**
 * Checks whether `current + increment` stays within the plan limit.
 * `null` limit means unlimited (fair use enforced elsewhere).
 */
export function checkAndIncrementUsage(input: {
  plan: PlanId
  metric: UsageMetric
  current: number
  increment: number
}): UsageIncrementResult {
  const limit = limitForMetric(input.plan, input.metric)
  if (limit === null) {
    return { ok: true, newValue: input.current + input.increment }
  }
  if (
    input.metric === "emails_sent" &&
    !limitsForPlan(input.plan).emailApplications
  ) {
    return { ok: false, code: "feature_denied" }
  }
  const next = input.current + input.increment
  if (next > limit) {
    return { ok: false, code: "limit_exceeded", limit }
  }
  return { ok: true, newValue: next }
}

export function assertFeature(
  plan: PlanId,
  feature: keyof PlanFeatures
): UsageIncrementResult {
  const limits = limitsForPlan(plan)
  if (!limits[feature]) {
    return { ok: false, code: "feature_denied" }
  }
  return { ok: true, newValue: 0 }
}

/** Default estimated cost per job analysis (spec NF: < R$ 0,15). */
export const DEFAULT_JOB_ANALYSIS_COST_CENTS = 15

/** Default estimated cost per orchestrator turn (small). */
export const DEFAULT_CHAT_TURN_COST_CENTS = 3
