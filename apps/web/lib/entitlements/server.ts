import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  checkAndIncrementUsage,
  DEFAULT_CHAT_TURN_COST_CENTS,
  DEFAULT_JOB_ANALYSIS_COST_CENTS,
  effectivePlan,
  type PlanFeatures,
  type PlanId,
  type UsageMetric,
  usagePeriod,
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

export type PlanSnapshot = {
  plan: PlanId
  trialing: boolean
  analysesUsed: number
  analysesLimit: number | null
}

export async function getUserPlan(
  admin: SupabaseClient,
  userId: string,
  now = new Date()
): Promise<PlanId> {
  const { data } = await admin
    .from("subscriptions")
    .select("plan, status, current_period_end")
    .eq("user_id", userId)
    .maybeSingle()
  const row = data as {
    plan?: string
    status?: string | null
    current_period_end?: string | null
  } | null
  return effectivePlan({
    plan: row?.plan,
    status: row?.status,
    currentPeriodEnd: row?.current_period_end,
    now,
  })
}

export async function getPlanSnapshot(userId: string): Promise<PlanSnapshot> {
  const admin = getAdminClient()
  const free = {
    plan: "free" as const,
    trialing: false,
    analysesUsed: 0,
    analysesLimit: limitsForPlan("free").jobAnalysesPerMonth,
  }
  if (!admin) return free
  const now = new Date()
  const { data } = await admin
    .from("subscriptions")
    .select("plan, status, current_period_end")
    .eq("user_id", userId)
    .maybeSingle()
  const row = data as {
    plan?: string
    status?: string | null
    current_period_end?: string | null
  } | null
  const plan = effectivePlan({
    plan: row?.plan,
    status: row?.status,
    currentPeriodEnd: row?.current_period_end,
    now,
  })
  return {
    plan,
    trialing: plan === "pro" && row?.status === "trialing",
    analysesUsed: await readCounter(admin, userId, "job_analyses", now),
    analysesLimit: limitsForPlan(plan).jobAnalysesPerMonth,
  }
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

async function atomicIncrementCounter(
  admin: SupabaseClient,
  userId: string,
  metric: UsageMetric,
  at: Date,
  delta: number
): Promise<number> {
  const period = usagePeriod(metric, at)
  const { data, error } = await admin.rpc("increment_usage", {
    p_user_id: userId,
    p_period: period,
    p_metric: metric,
    p_delta: delta,
  })
  if (error) throw new Error(`usage_counter_increment_failed:${error.message}`)
  const value = Number(data)
  if (!Number.isFinite(value)) {
    throw new Error("usage_counter_increment_failed:invalid_return")
  }
  return value
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
  const limit = limitsForPlan(plan)
  if (metric === "emails_sent" && increment > 0 && !limit.emailApplications) {
    throw new EntitlementError(
      "feature_denied",
      "Feature not available on your plan."
    )
  }

  const newValue = await atomicIncrementCounter(
    admin,
    userId,
    metric,
    at,
    increment
  )
  const checked = checkAndIncrementUsage({
    plan,
    metric,
    current: newValue - increment,
    increment,
  })
  if (!checked.ok) {
    await atomicIncrementCounter(admin, userId, metric, at, -increment)
    throw new EntitlementError(
      checked.code,
      checked.code === "limit_exceeded"
        ? "Plan limit reached."
        : "Feature not available on your plan."
    )
  }
  return newValue
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
