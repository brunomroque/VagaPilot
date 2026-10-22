import "server-only"

import type { UserContext } from "@/lib/server/context"
import { loadPreferences } from "@/lib/profile/server"

/** J1 / P1.4 steps, in order. */
export const ONBOARDING_STEPS = [
  "cvs",
  "fatos",
  "trilhas",
  "respostas",
  "bloqueadas",
  "convites",
] as const
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number]

export type OnboardingRequirements = {
  hasCv: boolean
  hasSalaryRule: boolean
  hasLanguage: boolean
  hasWorkModels: boolean
  hasRegimes: boolean
  hasAvailability: boolean
}

export type OnboardingState = {
  /** 1-based step saved for "continuar depois". */
  savedStep: number
  completedAt: string | null
  requirements: OnboardingRequirements
}

export function answersComplete(requirements: OnboardingRequirements): boolean {
  return (
    requirements.hasSalaryRule &&
    requirements.hasLanguage &&
    requirements.hasWorkModels &&
    requirements.hasRegimes &&
    requirements.hasAvailability
  )
}

/** CA1.1: minimum onboarding = 1 CV + required answers. */
export function canComplete(requirements: OnboardingRequirements): boolean {
  return requirements.hasCv && answersComplete(requirements)
}

async function count(
  ctx: UserContext,
  table: "cv_versions" | "salary_rules" | "languages"
): Promise<number> {
  const { count: total, error } = await ctx.supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("user_id", ctx.user.id)
  if (error) throw new Error(error.message)
  return total ?? 0
}

export async function loadOnboardingState(
  ctx: UserContext
): Promise<OnboardingState> {
  const [preferences, cvs, salaryRules, languages] = await Promise.all([
    loadPreferences(ctx),
    count(ctx, "cv_versions"),
    count(ctx, "salary_rules"),
    count(ctx, "languages"),
  ])
  const saved = preferences.onboarding?.step ?? 1
  return {
    savedStep: Math.min(Math.max(saved, 1), ONBOARDING_STEPS.length),
    completedAt: preferences.onboarding?.completedAt ?? null,
    requirements: {
      hasCv: cvs > 0,
      hasSalaryRule: salaryRules > 0,
      hasLanguage: languages > 0,
      hasWorkModels: (preferences.workModels ?? []).length > 0,
      hasRegimes: (preferences.regimes ?? []).length > 0,
      hasAvailability: Boolean(preferences.availability),
    },
  }
}
