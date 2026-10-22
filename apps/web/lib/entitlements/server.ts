import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  checkAndIncrementUsage,
  DEFAULT_CHAT_TURN_COST_CENTS,
  DEFAULT_JOB_ANALYSIS_COST_CENTS,
  type PlanFeatures,
  type PlanId,
  type UsageMetric,
  usagePeriod,
  isPlanId,
  limitsForPlan,
} from "@vagapilot/core/entitlements"
import type { JobAnalysisUsage } from "@vagapilot/jobs"

import { getAdminClient } from "@/lib/server/admin"

export class EntitlementError extends Error {
  constructor(
    readonly code: "limit_exceeded" | "feature_denied",
    message: string
  ) {
    super(message)
    this.name = "EntitlementError"
  }
}

export async function getUserPlan(
  admin: SupabaseClient,
  userId: string
): Promise<PlanId> {
  const { data } = await admin
    .from("subscriptions")
    .select("plan, status")
    .eq("user_id", userId)
    .maybeSingle()
  const row = data as { plan?: string; status?: string | null } | null
  const rawPlan = row?.plan ?? "free"
  if (!isPlanId(rawPlan) || rawPlan === "free") return "free"
  const status = row?.status ?? ""
  if (status === "active" || status === "trialing") return rawPlan
  return "free"
}

async function readCounter(
  admin: SupabaseClient,
  userId: string,
  metric: UsageMetric,
  at: Date
): Promise<number> {
  const period = usagePeriod(metric, at)
  const { data } = await admin
    .from("usage_counters")
    .select("value")
    .eq("user_id", userId)
    .eq("period", period)
    .eq("metric", metric)
    .maybeSingle()
  return Number((data as { value?: number } | null)?.value ?? 0)
}

async function writeCounter(
  admin: SupabaseClient,
  userId: string,
  metric: UsageMetric,
  at: Date,
  value: number
): Promise<void> {
  const period = usagePeriod(metric, at)
  const { error } = await admin
    .from("usage_counters")
    .upsert(
      { user_id: userId, period, metric, value },
      { onConflict: "user_id,period,metric" }
    )
  if (error) throw new Error(`usage_counter_write_failed:${error.message}`)
}

export async function incrementUsage(
  userId: string,
  metric: UsageMetric,
  increment: number,
  at = new Date()
): Promise<number> {
  const admin = getAdminClient()
  if (!admin) throw new Error("admin_not_configured")
  const plan = await getUserPlan(admin, userId)
  const current = await readCounter(admin, userId, metric, at)
  const checked = checkAndIncrementUsage({ plan, metric, current, increment })
  if (!checked.ok) {
    throw new EntitlementError(
      checked.code,
      checked.code === "limit_exceeded"
        ? "Plan limit reached."
        : "Feature not available on your plan."
    )
  }
  await writeCounter(admin, userId, metric, at, checked.newValue)
  return checked.newValue
}

export async function assertUsageHeadroom(
  userId: string,
  metric: UsageMetric,
  increment: number,
  at = new Date()
): Promise<void> {
  const admin = getAdminClient()
  if (!admin) return
  const plan = await getUserPlan(admin, userId)
  const current = await readCounter(admin, userId, metric, at)
  const checked = checkAndIncrementUsage({ plan, metric, current, increment })
  if (!checked.ok) {
    throw new EntitlementError(
      checked.code,
      checked.code === "limit_exceeded"
        ? "Plan limit reached."
        : "Feature not available on your plan."
    )
  }
}

export async function assertFeatureEnabled(
  userId: string,
  feature: keyof PlanFeatures
): Promise<void> {
  const admin = getAdminClient()
  if (!admin) return
  const plan = await getUserPlan(admin, userId)
  const limits = limitsForPlan(plan)
  if (!limits[feature]) {
    throw new EntitlementError(
      "feature_denied",
      "Feature not available on your plan."
    )
  }
}

export function createJobAnalysisUsage(): JobAnalysisUsage {
  return {
    beforeExtract: (userId: string) =>
      assertUsageHeadroom(userId, "job_analyses", 1).then(() =>
        assertUsageHeadroom(
          userId,
          "llm_cost_cents",
          DEFAULT_JOB_ANALYSIS_COST_CENTS
        )
      ),
    beforeAssess: (userId: string) =>
      assertUsageHeadroom(
        userId,
        "llm_cost_cents",
        DEFAULT_JOB_ANALYSIS_COST_CENTS
      ),
    afterComplete: async (userId: string) => {
      await incrementUsage(userId, "job_analyses", 1)
      await incrementUsage(
        userId,
        "llm_cost_cents",
        DEFAULT_JOB_ANALYSIS_COST_CENTS
      )
    },
  }
}

export async function assertOrchestratorBillable(
  userId: string
): Promise<void> {
  await assertUsageHeadroom(
    userId,
    "llm_cost_cents",
    DEFAULT_CHAT_TURN_COST_CENTS
  )
}

export async function recordOrchestratorCost(userId: string): Promise<void> {
  await incrementUsage(userId, "llm_cost_cents", DEFAULT_CHAT_TURN_COST_CENTS)
}
