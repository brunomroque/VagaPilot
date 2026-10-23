import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Per-ATS success/failure metrics (table `apply_run_outcomes`, view `apply_ats_success_rates`).
 * One row per segment outcome; no PII beyond ids and the site domain.
 */
export type ApplyOutcomeRow = {
  run_id: string
  user_id: string
  ats: string
  driver: "specific" | "generic_ai"
  site: string
  outcome: string
  code: string | null
  duration_ms: number
  /** Generic driver only: LLM calls/tokens of this segment and steps replayed from a recipe. */
  llm_calls?: number
  llm_tokens?: number
  replayed_steps?: number
}

export async function recordApplyOutcome(
  admin: SupabaseClient,
  row: ApplyOutcomeRow
): Promise<void> {
  await Promise.resolve(admin.from("apply_run_outcomes").insert(row)).catch(
    () => undefined
  )
}

export type AtsSuccessRate = {
  ats: string
  driver: string
  site: string
  attempts: number
  submitted: number
  failed: number
  escalated: number
  success_rate: number | null
}

export async function atsSuccessRates(
  admin: SupabaseClient
): Promise<AtsSuccessRate[]> {
  const { data, error } = await admin
    .from("apply_ats_success_rates")
    .select("*")
  if (error) throw new Error(error.message)
  return (data ?? []) as AtsSuccessRate[]
}
