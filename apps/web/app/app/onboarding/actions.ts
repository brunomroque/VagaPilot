"use server"

import { z } from "zod"

import {
  canComplete,
  loadOnboardingState,
  ONBOARDING_STEPS,
} from "@/lib/onboarding/server"
import { loadPreferences, updatePreferences } from "@/lib/profile/server"
import { audit } from "@/lib/server/audit"
import { fail, getUserContext, ok } from "@/lib/server/context"

const stepSchema = z.number().int().min(1).max(ONBOARDING_STEPS.length)

/** "Salvar e continuar depois": remembers the step to resume from. */
export async function saveOnboardingStep(step: number) {
  const parsed = stepSchema.safeParse(step)
  if (!parsed.success) return fail("invalid_request", "Invalid step.")
  const context = await getUserContext()
  if (!context.ok) return { ok: false as const, error: context.error }
  try {
    const current = (await loadPreferences(context.ctx)).onboarding
    await updatePreferences(context.ctx, {
      onboarding: { ...current, step: parsed.data },
    })
    return ok(undefined)
  } catch (error) {
    console.error(
      "[onboarding:step]",
      error instanceof Error ? error.message : error
    )
    return fail("internal_error", "Could not save progress.")
  }
}

/** CA1.1: finishing needs 1 CV and the required answers; the client then opens /app/chat. */
export async function completeOnboarding() {
  const context = await getUserContext()
  if (!context.ok) return { ok: false as const, error: context.error }
  try {
    const state = await loadOnboardingState(context.ctx)
    if (!canComplete(state.requirements)) {
      return fail(
        "invalid_request",
        "Upload one CV and fill the required answers first."
      )
    }
    const completedAt = new Date().toISOString()
    await updatePreferences(context.ctx, {
      onboarding: { step: ONBOARDING_STEPS.length, completedAt },
    })
    await audit({
      userId: context.ctx.user.id,
      actor: "usuario",
      action: "settings.changed",
      targetType: "candidate_profile",
      details: { section: "onboarding", completed: true },
    })
    return ok({ completedAt })
  } catch (error) {
    console.error(
      "[onboarding:complete]",
      error instanceof Error ? error.message : error
    )
    return fail("internal_error", "Could not finish onboarding.")
  }
}
