import "server-only"

import { after } from "next/server"

import { driverForUrl, enabledDrivers } from "@vagapilot/browser-pool/apply"
import { isPoolEnabled } from "@vagapilot/browser-pool"

import { recordDecision } from "@/lib/chat/jobs-server"
import { createApplicationPackage } from "@/lib/ext/packages"
import { getAdminClient } from "@/lib/server/admin"
import { audit } from "@/lib/server/audit"
import type { UserContext } from "@/lib/server/context"
import { openColumnText } from "@/lib/server/field-crypto"

export type ApplyRunView = {
  id: string
  applicationId: string
  ats: string
  targetUrl: string
  phase: string
  liveViewUrl: string | null
  lastError: string | null
  approvalId: string | null
  reviewFields: { label: string; value: string }[]
  hasScreenshot: boolean
  questions: { id: string; question: string; options: string[] }[]
  updatedAt: string
}

const ACTIVE = ["queued", "running", "login_required", "waiting_answers", "captcha", "review_ready", "submit_approved", "submitting"]

export function cloudApplyAvailable(url: string | null): { ok: boolean; reason?: string } {
  if (!isPoolEnabled()) return { ok: false, reason: "pool_disabled" }
  if (!url) return { ok: false, reason: "no_url" }
  if (!driverForUrl(url, enabledDrivers())) return { ok: false, reason: "unsupported_ats" }
  return { ok: true }
}

/**
 * Starts the background worker for a run. On Netlify it calls the background function (15 min
 * budget); locally (`next dev`) it runs inline after the response.
 */
export async function kickApplyRun(runId: string): Promise<void> {
  const secret = process.env.APPLY_RUNNER_SECRET
  const siteUrl = process.env.URL ?? process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL
  if (process.env.NETLIFY && siteUrl && secret) {
    await fetch(`${siteUrl.replace(/\/$/, "")}/.netlify/functions/apply-runner-background`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-apply-runner-secret": secret },
      body: JSON.stringify({ runId }),
    }).catch((error: unknown) => console.error("apply runner kick failed", { reason: String(error) }))
    return
  }
  after(async () => {
    const { runApplyJob } = await import("@vagapilot/browser-pool/job")
    await runApplyJob(runId, { requeue: kickApplyRun }).catch((error: unknown) =>
      console.error("apply run failed", { reason: error instanceof Error ? error.message : "unknown" })
    )
  })
}

/** Decision "aplicar" + package + apply_run, then kicks the worker. Idempotent per application. */
export async function startCloudApplication(
  ctx: UserContext,
  matchId: string
): Promise<{ runId: string; applicationId: string } | { error: string }> {
  const decision = await recordDecision(ctx, { matchId, decision: "aplicar", reason: null, source: "usuario" })
  const url = decision.applyUrl
  const available = cloudApplyAvailable(url)
  if (!available.ok || !url) return { error: available.reason ?? "unavailable" }
  const admin = getAdminClient()
  if (!admin) return { error: "server_not_configured" }
  const existing = await admin
    .from("apply_runs")
    .select("id, phase")
    .eq("user_id", ctx.user.id)
    .eq("application_id", decision.applicationId)
    .in("phase", ACTIVE)
    .maybeSingle()
  if (existing.data) {
    const row = existing.data as { id: string }
    return { runId: row.id, applicationId: decision.applicationId }
  }
  const { packageId } = await createApplicationPackage(ctx, decision.applicationId)
  const driver = driverForUrl(url, enabledDrivers())!
  const inserted = await admin
    .from("apply_runs")
    .insert({
      user_id: ctx.user.id,
      application_id: decision.applicationId,
      job_match_id: matchId,
      package_id: packageId,
      ats: driver.ats,
      target_url: url,
      phase: "queued",
    })
    .select("id")
    .single()
  if (inserted.error || !inserted.data) return { error: "insert_failed" }
  const runId = (inserted.data as { id: string }).id
  await audit({
    userId: ctx.user.id,
    actor: "usuario",
    action: "apply.run_started",
    targetType: "apply_run",
    targetId: runId,
    details: { ats: driver.ats },
  })
  await kickApplyRun(runId)
  return { runId, applicationId: decision.applicationId }
}

export async function loadApplyRun(ctx: UserContext, runId: string): Promise<ApplyRunView | null> {
  const admin = getAdminClient()
  if (!admin) return null
  const { data } = await admin
    .from("apply_runs")
    .select("id, application_id, ats, target_url, phase, live_view_url, last_error, approval_id, review_summary, review_screenshot_enc, updated_at")
    .eq("id", runId)
    .eq("user_id", ctx.user.id)
    .maybeSingle()
  const row = data as {
    id: string
    application_id: string
    ats: string
    target_url: string
    phase: string
    live_view_url: string | null
    last_error: string | null
    approval_id: string | null
    review_summary: { fields?: { label: string; value: string }[] } | null
    review_screenshot_enc: string | null
    updated_at: string
  } | null
  if (!row) return null
  const questions =
    row.phase === "waiting_answers"
      ? (
          await ctx.supabase
            .from("pending_questions")
            .select("id, question_text, options")
            .eq("application_id", row.application_id)
            .eq("user_id", ctx.user.id)
            .eq("status", "aberta")
        ).data ?? []
      : []
  return {
    id: row.id,
    applicationId: row.application_id,
    ats: row.ats,
    targetUrl: row.target_url,
    phase: row.phase,
    liveViewUrl: ["running", "login_required", "captcha", "submitting"].includes(row.phase) ? row.live_view_url : null,
    lastError: row.last_error,
    approvalId: row.approval_id,
    reviewFields: row.review_summary?.fields ?? [],
    hasScreenshot: Boolean(row.review_screenshot_enc),
    questions: (questions as { id: string; question_text: string; options: unknown }[]).map((q) => ({
      id: q.id,
      question: q.question_text,
      options: Array.isArray(q.options) ? q.options.map(String) : [],
    })),
    updatedAt: row.updated_at,
  }
}

export async function loadRunScreenshot(ctx: UserContext, runId: string): Promise<Buffer | null> {
  const admin = getAdminClient()
  if (!admin) return null
  const { data } = await admin
    .from("apply_runs")
    .select("review_screenshot_enc")
    .eq("id", runId)
    .eq("user_id", ctx.user.id)
    .maybeSingle()
  const b64 = await openColumnText(ctx.user.id, (data as { review_screenshot_enc?: string } | null)?.review_screenshot_enc)
  return b64 ? Buffer.from(b64, "base64") : null
}

/** Moves a paused run back to the queue (answers given, login/captcha solved). */
export async function resumeApplyRun(userId: string, filter: { runId?: string; applicationId?: string }): Promise<string | null> {
  const admin = getAdminClient()
  if (!admin) return null
  let query = admin
    .from("apply_runs")
    .update({ phase: "queued", lease_until: null, updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .in("phase", ["waiting_answers", "login_required", "captcha"])
  if (filter.runId) query = query.eq("id", filter.runId)
  if (filter.applicationId) query = query.eq("application_id", filter.applicationId)
  const { data } = await query.select("id").maybeSingle()
  const runId = (data as { id: string } | null)?.id ?? null
  if (runId) await kickApplyRun(runId)
  return runId
}

/** Called by decideApproval for kind submeter_formulario. */
export async function onSubmitApprovalDecided(userId: string, approvalId: string, approved: boolean): Promise<void> {
  const admin = getAdminClient()
  if (!admin) return
  const { data } = await admin
    .from("apply_runs")
    .update({ phase: approved ? "submit_approved" : "cancelled", lease_until: null, updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("approval_id", approvalId)
    .eq("phase", "review_ready")
    .select("id")
    .maybeSingle()
  const runId = (data as { id: string } | null)?.id
  if (runId && approved) await kickApplyRun(runId)
}

export async function cancelApplyRun(userId: string, runId: string): Promise<boolean> {
  const admin = getAdminClient()
  if (!admin) return false
  const { data } = await admin
    .from("apply_runs")
    .update({ phase: "cancelled", lease_until: null, updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("id", runId)
    .in("phase", ACTIVE)
    .select("id")
    .maybeSingle()
  return Boolean(data)
}
