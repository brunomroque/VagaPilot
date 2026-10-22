"use server"

import { refresh } from "next/cache"
import { z } from "zod"

import { APPROVAL_MODES, PREFERENCE_KEYS } from "@vagapilot/core/settings"

import { fail, ok, type ActionResult } from "@/lib/action-result"
import type { SettingsChangeOutput } from "@/lib/chat/types"
import { getUserContext } from "@/lib/server/context"
import { applySettingChange, type SettingIntent } from "@/lib/settings/server"

/*
 * Form side of the F14 settings (RF14.1: "As mesmas configurações continuam editáveis por
 * formulário"). Same service as the chat, origin "formulario", same Memory events (CA14.4).
 */

async function change(
  intent: SettingIntent,
  input: unknown,
  confirmed = false
): Promise<ActionResult<SettingsChangeOutput>> {
  const context = await getUserContext()
  if (!context.ok) return fail(context.error.code, context.error.message)
  const result = await applySettingChange(context.ctx, {
    intent,
    input,
    origin: "formulario",
    policyOrigin: "form",
    confirmed,
  })
  if (result.status === "error") return fail("invalid_request", result.summary)
  refresh()
  return ok(result)
}

export async function setPreferenceAction(input: unknown) {
  const parsed = z
    .object({
      key: z.enum(PREFERENCE_KEYS),
      value: z.union([z.boolean(), z.string()]),
    })
    .safeParse(input)
  if (!parsed.success) return fail("invalid_request", "Invalid preference.")
  return change("set_preference", parsed.data)
}

/** The page asks for confirmation in a dialog before calling this (CA14.3). */
export async function setApprovalModeAction(input: unknown) {
  const parsed = z.object({ mode: z.enum(APPROVAL_MODES) }).safeParse(input)
  if (!parsed.success) return fail("invalid_request", "Invalid mode.")
  return change("set_approval_mode", parsed.data, true)
}

export async function addExcludedCompanyAction(input: unknown) {
  const parsed = z
    .object({ company: z.string().trim().min(1).max(160) })
    .safeParse(input)
  if (!parsed.success) return fail("invalid_request", "Invalid company.")
  return change("add_excluded_company", parsed.data)
}

export async function removeExcludedCompanyAction(input: unknown) {
  const parsed = z
    .object({ company: z.string().trim().min(1).max(160) })
    .safeParse(input)
  if (!parsed.success) return fail("invalid_request", "Invalid company.")
  return change("remove_excluded_company", parsed.data)
}
