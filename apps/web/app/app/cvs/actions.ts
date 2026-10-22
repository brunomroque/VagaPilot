"use server"

import { CV_LANGUAGES } from "@vagapilot/core/cv-filename"
import { SupabaseAuditSink } from "@vagapilot/db/server"
import {
  cvUploadedEvent,
  inngest,
  isInngestConfigured,
  processCvUpload,
} from "@vagapilot/jobs"
import { refresh } from "next/cache"
import { z } from "zod"

import { ownsTrack } from "@/lib/cvs/server"
import { splitList } from "@/lib/profile/schemas"
import { getAdminClient } from "@/lib/server/admin"
import { audit } from "@/lib/server/audit"
import {
  fail,
  getUserContext,
  ok,
  type ActionResult,
  type UserContext,
} from "@/lib/server/context"

async function run<T>(
  name: string,
  work: (ctx: UserContext) => Promise<ActionResult<T>>
): Promise<ActionResult<T>> {
  const context = await getUserContext()
  if (!context.ok) return { ok: false, error: context.error }
  try {
    const result = await work(context.ctx)
    if (result.ok) refresh()
    return result
  } catch (error) {
    console.error(
      `[cvs:${name}]`,
      error instanceof Error ? error.message : error
    )
    return fail("internal_error", "Could not save.")
  }
}

const trackSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1, "required").max(80, "tooLong"),
  description: z.string().trim().max(300, "tooLong"),
  keywords: z.string().trim().max(500, "tooLong"),
})
export type TrackInput = z.infer<typeof trackSchema>

export async function saveTrack(input: unknown) {
  return run("track", async (ctx) => {
    const parsed = trackSchema.safeParse(input)
    if (!parsed.success) return fail("invalid_request", "Invalid track.")
    const data = parsed.data
    const row = {
      user_id: ctx.user.id,
      name: data.name,
      description: data.description || null,
      keywords: splitList(data.keywords),
    }
    const result = data.id
      ? await ctx.supabase
          .from("cv_tracks")
          .update(row)
          .eq("id", data.id)
          .eq("user_id", ctx.user.id)
          .select("id")
      : await ctx.supabase.from("cv_tracks").insert(row).select("id")
    if (result.error) throw new Error(result.error.message)
    const id = (result.data as { id: string }[])[0]?.id
    if (!id) return fail("not_found", "Track not found.")
    await audit({
      userId: ctx.user.id,
      actor: "usuario",
      action: "settings.changed",
      targetType: "cv_track",
      targetId: id,
      details: { section: "cv_track", op: data.id ? "update" : "create" },
    })
    return ok({ id })
  })
}

export async function deleteTrack(id: string) {
  return run("track", async (ctx) => {
    if (!z.uuid().safeParse(id).success)
      return fail("invalid_request", "Invalid id.")
    const result = await ctx.supabase
      .from("cv_tracks")
      .delete()
      .eq("id", id)
      .eq("user_id", ctx.user.id)
    if (result.error) throw new Error(result.error.message)
    return ok(undefined)
  })
}

const versionSchema = z.object({
  id: z.uuid(),
  trackId: z.uuid().nullable(),
  language: z.enum(CV_LANGUAGES),
  label: z.string().trim().min(1, "required").max(80, "tooLong"),
})
export type VersionInput = z.infer<typeof versionSchema>

export async function updateCvVersion(input: unknown) {
  return run("version", async (ctx) => {
    const parsed = versionSchema.safeParse(input)
    if (!parsed.success) return fail("invalid_request", "Invalid CV version.")
    const data = parsed.data
    if (data.trackId && !(await ownsTrack(ctx, data.trackId))) {
      return fail("invalid_request", "Track not found.")
    }
    const current = await ctx.supabase
      .from("cv_versions")
      .select("track_id, language")
      .eq("id", data.id)
      .eq("user_id", ctx.user.id)
      .maybeSingle<{ track_id: string | null; language: string }>()
    if (current.error) throw new Error(current.error.message)
    if (!current.data) return fail("not_found", "CV not found.")
    const moved =
      current.data.track_id !== data.trackId ||
      current.data.language !== data.language

    let isDefault: boolean | undefined
    if (moved && data.trackId) {
      const defaults = await ctx.supabase
        .from("cv_versions")
        .select("id")
        .eq("user_id", ctx.user.id)
        .eq("track_id", data.trackId)
        .eq("language", data.language)
        .eq("is_default", true)
        .neq("id", data.id)
      if (defaults.error) throw new Error(defaults.error.message)
      isDefault = (defaults.data ?? []).length === 0
    } else if (moved) {
      isDefault = false
    }

    const result = await ctx.supabase
      .from("cv_versions")
      .update({
        track_id: data.trackId,
        language: data.language,
        label: data.label,
        ...(isDefault === undefined ? {} : { is_default: isDefault }),
      })
      .eq("id", data.id)
      .eq("user_id", ctx.user.id)
    if (result.error) throw new Error(result.error.message)
    return ok(undefined)
  })
}

/** RF3.2: one default per track × language. */
export async function setDefaultCvVersion(id: string) {
  return run("default", async (ctx) => {
    if (!z.uuid().safeParse(id).success)
      return fail("invalid_request", "Invalid id.")
    const version = await ctx.supabase
      .from("cv_versions")
      .select("track_id, language")
      .eq("id", id)
      .eq("user_id", ctx.user.id)
      .maybeSingle<{ track_id: string | null; language: string }>()
    if (version.error) throw new Error(version.error.message)
    if (!version.data?.track_id)
      return fail("invalid_request", "Assign a track first.")
    const clear = await ctx.supabase
      .from("cv_versions")
      .update({ is_default: false })
      .eq("user_id", ctx.user.id)
      .eq("track_id", version.data.track_id)
      .eq("language", version.data.language)
    if (clear.error) throw new Error(clear.error.message)
    const set = await ctx.supabase
      .from("cv_versions")
      .update({ is_default: true })
      .eq("id", id)
      .eq("user_id", ctx.user.id)
    if (set.error) throw new Error(set.error.message)
    return ok(undefined)
  })
}

export async function deleteCvVersion(id: string) {
  return run("delete", async (ctx) => {
    if (!z.uuid().safeParse(id).success)
      return fail("invalid_request", "Invalid id.")
    const version = await ctx.supabase
      .from("cv_versions")
      .select("storage_path, parent_version_id")
      .eq("id", id)
      .eq("user_id", ctx.user.id)
      .maybeSingle<{ storage_path: string; parent_version_id: string | null }>()
    if (version.error) throw new Error(version.error.message)
    if (!version.data) return fail("not_found", "CV not found.")

    const used = await ctx.supabase
      .from("applications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", ctx.user.id)
      .eq("cv_version_id", id)
    if (used.error) throw new Error(used.error.message)
    if ((used.count ?? 0) > 0) {
      return fail(
        "conflict",
        "This CV was used in an application and is kept as evidence."
      )
    }

    const relink = await ctx.supabase
      .from("cv_versions")
      .update({ parent_version_id: version.data.parent_version_id })
      .eq("user_id", ctx.user.id)
      .eq("parent_version_id", id)
    if (relink.error) throw new Error(relink.error.message)
    const removed = await ctx.supabase
      .from("cv_versions")
      .delete()
      .eq("id", id)
      .eq("user_id", ctx.user.id)
    if (removed.error) throw new Error(removed.error.message)
    await ctx.supabase.storage.from("cvs").remove([version.data.storage_path])
    return ok(undefined)
  })
}

/** Re-runs `cv/uploaded` for a version whose extraction failed or is pending. */
export async function reprocessCvVersion(id: string) {
  return run("reprocess", async (ctx) => {
    if (!z.uuid().safeParse(id).success)
      return fail("invalid_request", "Invalid id.")
    const version = await ctx.supabase
      .from("cv_versions")
      .select("id")
      .eq("id", id)
      .eq("user_id", ctx.user.id)
      .maybeSingle()
    if (version.error) throw new Error(version.error.message)
    if (!version.data) return fail("not_found", "CV not found.")
    if (isInngestConfigured()) {
      await inngest.send(
        cvUploadedEvent.create({ userId: ctx.user.id, cvVersionId: id })
      )
      return ok(undefined)
    }
    const admin = getAdminClient()
    if (!admin) return fail("not_configured", "Service role not configured.")
    await processCvUpload(
      { admin, audit: new SupabaseAuditSink(admin), actor: "sistema" },
      { userId: ctx.user.id, cvVersionId: id }
    )
    return ok(undefined)
  })
}
