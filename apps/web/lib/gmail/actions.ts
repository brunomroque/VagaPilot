"use server"

import { refresh } from "next/cache"
import { z } from "zod"

import { formatDateTimeBR } from "@vagapilot/core/dates"
import { isEmailClass } from "@vagapilot/core/email"
import { parseIsoWithOffset } from "@vagapilot/core/email-dates"
import { nextActionForEmailClass } from "@vagapilot/core/email-outcome"
import {
  APPLICATION_STATUSES,
  checkTransition,
  type ApplicationStatus,
} from "@vagapilot/core/status"
import { runGmailSync, type SyncResult } from "@vagapilot/gmail"
import {
  gmailSyncRequestedEvent,
  inngest,
  isInngestConfigured,
  runDueReminders,
  createMailerFromEnv,
} from "@vagapilot/jobs"

import { getAdminClient } from "@/lib/server/admin"
import {
  audit,
  getTrackerSession,
  type TrackerSession,
} from "@/lib/tracker/server"
import type { ActionErrorCode, ActionResult } from "@/lib/tracker/types"

import { getGmailRuntime } from "./runtime"

/*
 * Gmail server actions (P4.2/P4.3). "Sincronizar agora" runs the same pipeline as the cron for the
 * signed-in user (inline without Inngest). Review decisions run under the user's RLS session
 * with the P3 functions: a confirmed change keeps source gmail and is checked as a manual one.
 */

function fail<T>(code: ActionErrorCode, message: string): ActionResult<T> {
  return { ok: false, error: { code, message } }
}

async function session(): Promise<
  TrackerSession | { error: ActionResult<never> }
> {
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

export type SyncSummary = {
  status: SyncResult["status"] | "queued"
  applied: number
  review: number
  created: number
  stored: number
}

export async function syncGmailNow(): Promise<ActionResult<SyncSummary>> {
  const ctx = await session()
  if ("error" in ctx) return ctx.error
  try {
    const { assertFeatureEnabled } = await import("@/lib/entitlements/server")
    await assertFeatureEnabled(ctx.user.id, "gmail")
  } catch {
    return fail("invalid_request", "Gmail is not available on your plan.")
  }
  const runtime = getGmailRuntime()
  if (!runtime)
    return fail("not_configured", "Supabase service role is not configured.")

  if (isInngestConfigured()) {
    await inngest.send(gmailSyncRequestedEvent.create({ userId: ctx.user.id }))
    return {
      ok: true,
      data: { status: "queued", applied: 0, review: 0, created: 0, stored: 0 },
    }
  }

  const result = await runGmailSync(runtime, ctx.user.id, "incremental", {
    actor: "usuario",
  })
  const admin = getAdminClient()
  if (admin) {
    await runDueReminders(
      { admin, mailer: createMailerFromEnv() },
      { userId: ctx.user.id }
    )
  }
  refresh()
  const counts =
    result.status === "ok" || result.status === "stopped"
      ? {
          applied: result.applied,
          review: result.review,
          created: result.created,
          stored: result.stored,
        }
      : { applied: 0, review: 0, created: 0, stored: 0 }
  return { ok: true, data: { status: result.status, ...counts } }
}

const threadSelect =
  "id, application_id, classification, confidence, extracted, review_status, subject, from_address, received_at, snippet"

const threadSchema = z.object({
  id: z.string(),
  application_id: z.string().nullable(),
  classification: z.string().nullable(),
  confidence: z.coerce.number().nullable(),
  extracted: z.record(z.string(), z.unknown()).nullable(),
  review_status: z.string().nullable(),
  subject: z.string().nullable(),
  from_address: z.string().nullable(),
  received_at: z.string(),
  snippet: z.string().nullable(),
})

type Thread = z.infer<typeof threadSchema>

async function loadThread(
  ctx: TrackerSession,
  id: string
): Promise<Thread | null> {
  const { data } = await ctx.supabase
    .from("email_threads")
    .select(threadSelect)
    .eq("id", id)
    .eq("user_id", ctx.user.id)
    .maybeSingle()
  const parsed = threadSchema.safeParse(data)
  return parsed.success && parsed.data.review_status === "revisar"
    ? parsed.data
    : null
}

function suggestionOf(thread: Thread): {
  status: ApplicationStatus | null
  reason: string | null
} {
  const suggestion = thread.extracted?.suggestion as
    { status?: unknown; reason?: unknown } | undefined
  const status =
    APPLICATION_STATUSES.find((value) => value === suggestion?.status) ?? null
  return {
    status,
    reason: typeof suggestion?.reason === "string" ? suggestion.reason : null,
  }
}

async function applicationStatus(
  ctx: TrackerSession,
  id: string
): Promise<ApplicationStatus | null> {
  const { data } = await ctx.supabase
    .from("applications")
    .select("status")
    .eq("id", id)
    .eq("user_id", ctx.user.id)
    .maybeSingle<{ status: string }>()
  return APPLICATION_STATUSES.find((value) => value === data?.status) ?? null
}

/** Applies a confirmed or corrected status with the e-mail as evidence (CA11.5). */
async function applyConfirmedStatus(
  ctx: TrackerSession,
  thread: Thread,
  applicationId: string,
  to: ApplicationStatus,
  correction: boolean
): Promise<ActionResult<null> | null> {
  const from = await applicationStatus(ctx, applicationId)
  if (!from) return fail("not_found", "Application not found.")
  if (from === to) return null
  const check = checkTransition(from, to, {
    source: "gmail",
    confirmedByUser: true,
  })
  if (!check.ok) return fail("invalid_transition", check.reason)

  const { data: evidence } = await ctx.supabase
    .from("evidences")
    .insert({
      user_id: ctx.user.id,
      application_id: applicationId,
      kind: "email",
      text_excerpt: [
        `De: ${thread.from_address ?? ""}`,
        `Assunto: ${thread.subject ?? ""}`,
        `Data: ${formatDateTimeBR(new Date(thread.received_at))}`,
        `Trecho: ${thread.snippet ?? ""}`,
      ].join("\n"),
    })
    .select("id")
    .single<{ id: string }>()

  const { error } = await ctx.supabase.rpc("change_application_status", {
    p_application_id: applicationId,
    p_from: from,
    p_to: to,
    p_source: "gmail",
    p_confidence: thread.confidence,
    p_payload: { confirmed_by_user: true, correction, reopen: check.reopen },
    p_email_thread_id: thread.id,
    p_evidence_id: evidence?.id ?? null,
  })
  if (error) {
    return error.message.includes("status_conflict")
      ? fail("status_conflict", "The application changed in the meantime.")
      : fail("internal_error", "Could not save the change.")
  }
  await audit(ctx.supabase, {
    userId: ctx.user.id,
    actor: "usuario",
    action: "status.changed",
    targetType: "application",
    targetId: applicationId,
    details: { from, to, source: "gmail", confirmed_by_user: true, correction },
  })
  return null
}

/** Deadline or interview time of a confirmed e-mail becomes the next action (RF11.5). */
async function applyNextAction(
  ctx: TrackerSession,
  thread: Thread,
  applicationId: string
) {
  if (!isEmailClass(thread.classification)) return
  const action = nextActionForEmailClass(thread.classification)
  const key =
    thread.classification === "teste_etapa" ? "deadline" : "interview_at"
  const raw = thread.extracted?.[key]
  const dueAt = parseIsoWithOffset(typeof raw === "string" ? raw : null)
  if (!action || !dueAt || dueAt.getTime() <= Date.now()) return
  await ctx.supabase.rpc("set_application_next_action", {
    p_application_id: applicationId,
    p_next_action: action,
    p_due_at: dueAt.toISOString(),
    p_source: "gmail",
  })
}

async function closeThread(
  ctx: TrackerSession,
  thread: Thread,
  reviewStatus: "confirmado" | "ignorado",
  patch: {
    applicationId?: string | null
    correction?: Record<string, unknown>
  } = {}
) {
  const update: Record<string, unknown> = { review_status: reviewStatus }
  if (patch.applicationId !== undefined)
    update.application_id = patch.applicationId
  if (patch.correction)
    update.extracted = {
      ...(thread.extracted ?? {}),
      correction: patch.correction,
    }
  await ctx.supabase
    .from("email_threads")
    .update(update)
    .eq("id", thread.id)
    .eq("user_id", ctx.user.id)
}

/** RF11.7: an application created from a confirmation e-mail, removed when the user discards it. */
async function removeCreatedApplication(ctx: TrackerSession, thread: Thread) {
  if (
    suggestionOf(thread).reason !== "created_from_email" ||
    !thread.application_id
  )
    return
  await ctx.supabase
    .from("applications")
    .delete()
    .eq("id", thread.application_id)
    .eq("user_id", ctx.user.id)
    .eq("source", "email")
}

const idSchema = z.object({ id: z.uuid() })

export async function confirmReviewItem(
  input: unknown
): Promise<ActionResult<null>> {
  const parsed = idSchema.safeParse(input)
  if (!parsed.success) return fail("invalid_request", "Invalid item.")
  const ctx = await session()
  if ("error" in ctx) return ctx.error
  const thread = await loadThread(ctx, parsed.data.id)
  if (!thread) return fail("not_found", "Item not found.")

  const suggestion = suggestionOf(thread)
  if (suggestion.reason !== "created_from_email") {
    if (!thread.application_id || !suggestion.status) {
      return fail("invalid_request", "Choose the application first.")
    }
    const failed = await applyConfirmedStatus(
      ctx,
      thread,
      thread.application_id,
      suggestion.status,
      false
    )
    if (failed) return failed
    await applyNextAction(ctx, thread, thread.application_id)
  }
  await closeThread(ctx, thread, "confirmado")
  refresh()
  return { ok: true, data: null }
}

const correctSchema = z.object({
  id: z.uuid(),
  applicationId: z.uuid(),
  status: z.enum(APPLICATION_STATUSES).nullable(),
})

export async function correctReviewItem(
  input: unknown
): Promise<ActionResult<null>> {
  const parsed = correctSchema.safeParse(input)
  if (!parsed.success) return fail("invalid_request", "Invalid correction.")
  const ctx = await session()
  if ("error" in ctx) return ctx.error
  const thread = await loadThread(ctx, parsed.data.id)
  if (!thread) return fail("not_found", "Item not found.")
  const { applicationId, status } = parsed.data
  if (!(await applicationStatus(ctx, applicationId)))
    return fail("not_found", "Application not found.")

  if (status) {
    const failed = await applyConfirmedStatus(
      ctx,
      thread,
      applicationId,
      status,
      true
    )
    if (failed) return failed
    if (status === "etapa_pendente" || status === "entrevista")
      await applyNextAction(ctx, thread, applicationId)
  }
  if (thread.application_id && thread.application_id !== applicationId) {
    await removeCreatedApplication(ctx, thread)
  }
  await closeThread(ctx, thread, "confirmado", {
    applicationId,
    correction: { application_id: applicationId, status },
  })
  refresh()
  return { ok: true, data: null }
}

export async function ignoreReviewItem(
  input: unknown
): Promise<ActionResult<null>> {
  const parsed = idSchema.safeParse(input)
  if (!parsed.success) return fail("invalid_request", "Invalid item.")
  const ctx = await session()
  if ("error" in ctx) return ctx.error
  const thread = await loadThread(ctx, parsed.data.id)
  if (!thread) return fail("not_found", "Item not found.")
  await removeCreatedApplication(ctx, thread)
  await closeThread(ctx, thread, "ignorado")
  refresh()
  return { ok: true, data: null }
}

export async function markNotificationsRead(): Promise<ActionResult<null>> {
  const ctx = await session()
  if ("error" in ctx) return ctx.error
  await ctx.supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", ctx.user.id)
    .is("read_at", null)
  refresh()
  return { ok: true, data: null }
}
