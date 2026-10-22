"use server"

import { refresh } from "next/cache"

import { checkTransition, type ApplicationStatus } from "@vagapilot/core/status"
import { mapImportRows } from "@vagapilot/core/tracker-csv"

import { getApplicationDetail } from "./queries"
import {
  changeStatusSchema,
  createApplicationSchema,
  idSchema,
  importSchema,
  nextActionSchema,
  notesSchema,
} from "./schemas"
import {
  audit,
  getTrackerLabels,
  getTrackerSession,
  type TrackerSession,
} from "./server"
import type { ActionErrorCode, ActionResult, ApplicationDetail } from "./types"

/*
 * Tracker server actions (P3.1/P3.2). Each one re-checks the session, validates with Zod and
 * relies on RLS plus explicit ownership checks: FKs between user tables do not enforce the owner.
 */

function fail<T>(code: ActionErrorCode, message: string): ActionResult<T> {
  return { ok: false, error: { code, message } }
}

function rpcError<T>(message: string | undefined): ActionResult<T> {
  const text = message ?? ""
  if (text.includes("status_conflict")) {
    return fail("status_conflict", "The application changed in the meantime.")
  }
  if (text.includes("no_pending_action")) {
    return fail("no_pending_action", "There is no pending action.")
  }
  if (text.includes("not_found"))
    return fail("not_found", "Application not found.")
  return fail("internal_error", "Could not save the change.")
}

async function session() {
  const result = await getTrackerSession()
  if ("error" in result) {
    return {
      error: fail<never>(
        result.error,
        result.error === "unauthorized"
          ? "Sign in first."
          : "Supabase is not configured."
      ),
    }
  }
  return result
}

async function ownsCvVersion(
  ctx: TrackerSession,
  id: string
): Promise<boolean> {
  const { data, error } = await ctx.supabase
    .from("cv_versions")
    .select("id")
    .eq("id", id)
    .eq("user_id", ctx.user.id)
    .maybeSingle()
  return !error && data !== null
}

export async function changeApplicationStatus(
  input: unknown
): Promise<ActionResult<{ status: ApplicationStatus }>> {
  const parsed = changeStatusSchema.safeParse(input)
  if (!parsed.success) return fail("invalid_request", "Invalid status change.")
  const ctx = await session()
  if ("error" in ctx) return ctx.error

  const { id, from, to } = parsed.data
  const check = checkTransition(from, to, { source: "usuario" })
  if (!check.ok) return fail("invalid_transition", check.reason)

  const { error } = await ctx.supabase.rpc("change_application_status", {
    p_application_id: id,
    p_from: from,
    p_to: to,
    p_source: "usuario",
    p_payload: check.reopen ? { reopen: true } : {},
  })
  if (error) return rpcError(error.message)

  await audit(ctx.supabase, {
    userId: ctx.user.id,
    actor: "usuario",
    action: "status.changed",
    targetType: "application",
    targetId: id,
    details: { from, to, source: "usuario", reopen: check.reopen },
  })
  refresh()
  return { ok: true, data: { status: to } }
}

export async function createApplication(
  input: unknown
): Promise<ActionResult<{ id: string }>> {
  const parsed = createApplicationSchema.safeParse(input)
  if (!parsed.success) return fail("invalid_request", "Invalid application.")
  const ctx = await session()
  if ("error" in ctx) return ctx.error

  const value = parsed.data
  if (value.cvVersionId && !(await ownsCvVersion(ctx, value.cvVersionId))) {
    return fail("not_found", "CV version not found.")
  }

  const { data, error } = await ctx.supabase
    .from("applications")
    .insert({
      user_id: ctx.user.id,
      company: value.company,
      role_title: value.roleTitle,
      source: value.source,
      route: value.route,
      status: value.status,
      applied_at: value.appliedAt,
      cv_version_id: value.cvVersionId,
      salary_informed: value.salaryInformed
        ? { text: value.salaryInformed }
        : null,
      next_action: value.nextAction,
      next_action_due_at: value.nextAction ? value.nextActionDueAt : null,
      link: value.link,
      notes: value.notes,
    })
    .select("id")
    .single()
  if (error || !data)
    return fail("internal_error", "Could not create the application.")
  const id = String((data as { id: unknown }).id)

  const { error: eventError } = await ctx.supabase
    .from("application_events")
    .insert({
      user_id: ctx.user.id,
      application_id: id,
      type: "status_change",
      from_status: null,
      to_status: value.status,
      source: "usuario",
      payload: { created: true },
    })
  if (eventError) {
    await ctx.supabase.from("applications").delete().eq("id", id)
    return fail("internal_error", "Could not create the application.")
  }

  await audit(ctx.supabase, {
    userId: ctx.user.id,
    actor: "usuario",
    action: "status.changed",
    targetType: "application",
    targetId: id,
    details: { from: null, to: value.status, source: "usuario", created: true },
  })
  refresh()
  return { ok: true, data: { id } }
}

export async function setNextAction(input: unknown): Promise<ActionResult> {
  const parsed = nextActionSchema.safeParse(input)
  if (!parsed.success) return fail("invalid_request", "Invalid next action.")
  const ctx = await session()
  if ("error" in ctx) return ctx.error

  const { error } = await ctx.supabase.rpc("set_application_next_action", {
    p_application_id: parsed.data.id,
    p_next_action: parsed.data.action,
    p_due_at: parsed.data.dueAt,
    p_source: "usuario",
  })
  if (error) return rpcError(error.message)
  refresh()
  return { ok: true, data: null }
}

export async function completeNextAction(
  input: unknown
): Promise<ActionResult> {
  const parsed = idSchema.safeParse(input)
  if (!parsed.success) return fail("invalid_request", "Invalid application.")
  const ctx = await session()
  if ("error" in ctx) return ctx.error

  const { error } = await ctx.supabase.rpc("complete_application_action", {
    p_application_id: parsed.data.id,
    p_source: "usuario",
  })
  if (error) return rpcError(error.message)
  refresh()
  return { ok: true, data: null }
}

export async function updateNotes(input: unknown): Promise<ActionResult> {
  const parsed = notesSchema.safeParse(input)
  if (!parsed.success) return fail("invalid_request", "Invalid notes.")
  const ctx = await session()
  if ("error" in ctx) return ctx.error

  const { data, error } = await ctx.supabase
    .from("applications")
    .update({ notes: parsed.data.notes })
    .eq("id", parsed.data.id)
    .eq("user_id", ctx.user.id)
    .select("id")
    .maybeSingle()
  if (error) return fail("internal_error", "Could not save the notes.")
  if (!data) return fail("not_found", "Application not found.")

  await ctx.supabase.from("application_events").insert({
    user_id: ctx.user.id,
    application_id: parsed.data.id,
    type: "note",
    source: "usuario",
    payload: { cleared: parsed.data.notes === null },
  })
  refresh()
  return { ok: true, data: null }
}

export async function loadApplicationDetail(
  input: unknown
): Promise<ActionResult<ApplicationDetail>> {
  const parsed = idSchema.safeParse(input)
  if (!parsed.success) return fail("invalid_request", "Invalid application.")
  const ctx = await session()
  if ("error" in ctx) return ctx.error

  const detail = await getApplicationDetail(ctx.supabase, parsed.data.id)
  if (!detail) return fail("not_found", "Application not found.")
  return { ok: true, data: detail }
}

export type ImportSummary = {
  inserted: number
  totalRows: number
  truncated: boolean
  rejected: { line: number; reasons: string[] }[]
  elapsedMs: number
}

const INSERT_CHUNK = 500

/** CSV import with column mapping and rejected-row report (RF10.6, CA10.3). */
export async function importApplications(
  input: unknown
): Promise<ActionResult<ImportSummary>> {
  const started = Date.now()
  const parsed = importSchema.safeParse(input)
  if (!parsed.success) return fail("invalid_request", "Invalid import.")
  if (
    parsed.data.mapping.company === null ||
    parsed.data.mapping.roleTitle === null
  ) {
    return fail("invalid_request", "Map the company and role columns.")
  }
  const ctx = await session()
  if ("error" in ctx) return ctx.error

  const labels = await getTrackerLabels()
  const result = mapImportRows(parsed.data.csv, parsed.data.mapping, labels)

  let inserted = 0
  for (let start = 0; start < result.valid.length; start += INSERT_CHUNK) {
    const chunk = result.valid.slice(start, start + INSERT_CHUNK)
    const { data, error } = await ctx.supabase
      .from("applications")
      .insert(
        chunk.map((row) => ({
          user_id: ctx.user.id,
          company: row.company,
          role_title: row.roleTitle,
          source: row.source,
          route: row.route,
          status: row.status,
          applied_at: row.appliedAt,
          link: row.link,
          salary_informed: row.salaryInformed
            ? { text: row.salaryInformed }
            : null,
          next_action: row.nextAction,
          next_action_due_at: row.nextAction ? row.nextActionDueAt : null,
          notes: row.notes,
        }))
      )
      .select("id, status")
    if (error || !Array.isArray(data)) {
      return fail("internal_error", "Could not import the file.")
    }
    const createdRows = data as { id: string; status: ApplicationStatus }[]
    const { error: eventError } = await ctx.supabase
      .from("application_events")
      .insert(
        createdRows.map((row) => ({
          user_id: ctx.user.id,
          application_id: row.id,
          type: "status_change",
          from_status: null,
          to_status: row.status,
          source: "usuario",
          payload: { created: true, imported: true },
        }))
      )
    if (eventError) {
      await ctx.supabase
        .from("applications")
        .delete()
        .in(
          "id",
          createdRows.map((row) => row.id)
        )
      return fail("internal_error", "Could not import the file.")
    }
    inserted += createdRows.length
  }

  refresh()
  return {
    ok: true,
    data: {
      inserted,
      totalRows: result.totalRows,
      truncated: result.truncated,
      rejected: result.rejected,
      elapsedMs: Date.now() - started,
    },
  }
}
