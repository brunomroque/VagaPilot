"use server"

import { refresh } from "next/cache"
import { z } from "zod"

import {
  normalizeSavedSearch,
  savedSearchPatchSchema,
  type SavedSearchInput,
} from "@vagapilot/core/settings"
import {
  previewSearch,
  runSavedSearch,
  type SearchPreviewItem,
} from "@vagapilot/jobs"

import { fail, ok, type ActionResult } from "@/lib/action-result"
import type { SettingsChangeOutput } from "@/lib/chat/types"
import { getAdminClient } from "@/lib/server/admin"
import { getUserContext, type UserContext } from "@/lib/server/context"
import { searchFormSchema, formToSearchInput } from "@/lib/settings/search-form"
import { applySettingChange } from "@/lib/settings/server"

/*
 * "Buscas" form actions (RF4A.3, F14). Saving goes through the same settings service as the
 * chat tool, producing the same record and the same Memory event (CA14.4, CA14.7).
 */

async function session(): Promise<
  { ctx: UserContext } | { error: ActionResult<never> }
> {
  const result = await getUserContext()
  if (!result.ok)
    return { error: fail(result.error.code, result.error.message) }
  return { ctx: result.ctx }
}

function toInput(values: unknown): SavedSearchInput | null {
  const parsed = searchFormSchema.safeParse(values)
  if (!parsed.success) return null
  try {
    return normalizeSavedSearch(formToSearchInput(parsed.data))
  } catch {
    return null
  }
}

export async function saveSearchAction(
  input: unknown
): Promise<ActionResult<SettingsChangeOutput>> {
  const parsed = z
    .object({ id: z.uuid().nullish(), values: z.unknown() })
    .safeParse(input)
  if (!parsed.success) return fail("invalid_request", "Invalid search.")
  const search = toInput(parsed.data.values)
  if (!search) return fail("invalid_request", "Invalid search.")
  const auth = await session()
  if ("error" in auth) return auth.error
  const result = parsed.data.id
    ? await applySettingChange(auth.ctx, {
        intent: "update_saved_search",
        input: {
          id: parsed.data.id,
          changes: savedSearchPatchSchema.parse(search),
        },
        origin: "formulario",
        policyOrigin: "form",
        confirmed: true,
      })
    : await applySettingChange(auth.ctx, {
        intent: "create_saved_search",
        input: search,
        origin: "formulario",
        policyOrigin: "form",
        confirmed: true,
      })
  if (result.status === "error")
    return fail(
      result.code === "not_found" ? "not_found" : "invalid_request",
      result.summary
    )
  refresh()
  return ok(result)
}

/** The form has its own confirmation dialog, so deleting from it is an explicit confirmation. */
export async function deleteSearchAction(
  input: unknown
): Promise<ActionResult<SettingsChangeOutput>> {
  const parsed = z.object({ id: z.uuid() }).safeParse(input)
  if (!parsed.success) return fail("invalid_request", "Invalid search.")
  const auth = await session()
  if ("error" in auth) return auth.error
  const result = await applySettingChange(auth.ctx, {
    intent: "delete_saved_search",
    input: { id: parsed.data.id },
    origin: "formulario",
    policyOrigin: "form",
    confirmed: true,
  })
  if (result.status === "error") return fail("not_found", result.summary)
  refresh()
  return ok(result)
}

export async function previewSearchAction(
  input: unknown
): Promise<ActionResult<SearchPreviewItem[]>> {
  const search = toInput(input)
  if (!search) return fail("invalid_request", "Invalid search.")
  const auth = await session()
  if ("error" in auth) return auth.error
  const admin = getAdminClient()
  if (!admin)
    return fail("not_configured", "Supabase service role is not configured.")
  return ok(
    await previewSearch(
      { admin },
      auth.ctx.user.id,
      normalizeSavedSearch(search)
    )
  )
}

export async function runSearchNowAction(
  input: unknown
): Promise<ActionResult<{ batchId: string | null; delivered: number }>> {
  const parsed = z.object({ id: z.uuid() }).safeParse(input)
  if (!parsed.success) return fail("invalid_request", "Invalid search.")
  const auth = await session()
  if ("error" in auth) return auth.error
  const admin = getAdminClient()
  if (!admin)
    return fail("not_configured", "Supabase service role is not configured.")
  try {
    const result = await runSavedSearch(
      { admin },
      { userId: auth.ctx.user.id, savedSearchId: parsed.data.id }
    )
    refresh()
    return ok(result)
  } catch {
    return fail("not_found", "Search not found.")
  }
}

export async function toggleSearchAction(
  input: unknown
): Promise<ActionResult> {
  const parsed = z
    .object({ id: z.uuid(), active: z.boolean() })
    .safeParse(input)
  if (!parsed.success) return fail("invalid_request", "Invalid search.")
  const auth = await session()
  if ("error" in auth) return auth.error
  const { data, error } = await auth.ctx.supabase
    .from("saved_searches")
    .update({ active: parsed.data.active })
    .eq("id", parsed.data.id)
    .eq("user_id", auth.ctx.user.id)
    .select("id")
    .maybeSingle()
  if (error) return fail("internal_error", "Could not update the search.")
  if (!data) return fail("not_found", "Search not found.")
  refresh()
  return ok(undefined)
}
