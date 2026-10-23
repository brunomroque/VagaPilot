import "server-only"

import { after } from "next/server"

import { driverForUrl, enabledDrivers } from "@vagapilot/browser-pool/apply"
import { isPoolEnabled } from "@vagapilot/browser-pool"

import { recordDecision } from "@/lib/chat/jobs-server"
import { createApplicationPackage } from "@/lib/ext/packages"
import { getAdminClient } from "@/lib/server/admin"
import {
  isLowConfidenceField,
  riskAlerts,
  siteRiskLevel,
  type RiskAlert,
  type SiteRiskLevel,
} from "@vagapilot/core/risks"

import { cloudApplyConsent, consentMeta, loadSiteRiskLevels } from "@/lib/legal/server"
import { audit } from "@/lib/server/audit"
import type { UserContext } from "@/lib/server/context"
import { openColumnText } from "@/lib/server/field-crypto"
import type { SensitiveReport } from "@vagapilot/core/sensitive-report"

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
  questions: {
    id: string
    question: string
    options: string[]
    /** Terms/privacy/marketing box of the site: never ticked by the AI, asks Aceito/Cancelar. */
    consent: { termsUrl: string | null } | null
    /** Run card of a standing-permission action (4 choices) and the categories still missing. */
    card: { action: string; host: string | null; categories: string[]; missing: string[] } | null
  }[]
  /** Labels of review fields to highlight as low confidence. */
  lowConfidence: string[]
  siteRisk: SiteRiskLevel | null
  alerts: RiskAlert[]
  /** "Dados sensíveis enviados": owner-only, decrypted server-side (never in admin views). */
  sensitiveReport: SensitiveReport | null
  updatedAt: string
}

const ACTIVE = [
  "queued",
  "running",
  "login_required",
  "waiting_answers",
  "captcha",
  "review_ready",
  "submit_approved",
  "submitting",
]

export function cloudApplyAvailable(url: string | null): {
  ok: boolean
  reason?: string
} {
  if (!isPoolEnabled()) return { ok: false, reason: "pool_disabled" }
  if (!url) return { ok: false, reason: "no_url" }
  const generic =
    process.env.APPLY_GENERIC_AI_ENABLED === "true" &&
    /^https:/i.test(url) &&
    !/(^|\.)linkedin\.com$/i.test(new URL(url).hostname)
  if (!driverForUrl(url, enabledDrivers()) && !generic)
    return { ok: false, reason: "unsupported_ats" }
  return { ok: true }
}

/**
 * Starts the background worker for a run. On Netlify it calls the background function (15 min
 * budget); locally (`next dev`) it runs inline after the response.
 */
export async function kickApplyRun(runId: string): Promise<void> {
  const secret = process.env.APPLY_RUNNER_SECRET
  const siteUrl =
    process.env.URL ?? process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL
  if (process.env.NETLIFY && siteUrl && secret) {
    await fetch(
      `${siteUrl.replace(/\/$/, "")}/.netlify/functions/apply-runner-background`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-apply-runner-secret": secret,
        },
        body: JSON.stringify({ runId }),
      }
    ).catch((error: unknown) =>
      console.error("apply runner kick failed", { reason: String(error) })
    )
    return
  }
  after(async () => {
    const { runApplyJob } = await import("@vagapilot/browser-pool/job")
    const { applyJobExtras } = await import("./job-extras")
    await runApplyJob(runId, {
      requeue: kickApplyRun,
      ...(await applyJobExtras()),
    }).catch((error: unknown) =>
      console.error("apply run failed", {
        reason: error instanceof Error ? error.message : "unknown",
      })
    )
  })
}

/** Decision "aplicar" + package + apply_run, then kicks the worker. Idempotent per application. */
export async function startCloudApplication(
  ctx: UserContext,
  matchId: string
): Promise<{ runId: string; applicationId: string } | { error: string }> {
  // Versioned risk/terms acceptance gate: nothing is decided or queued without it.
  const consent = await cloudApplyConsent(ctx.user.id)
  if (!consent.ok) return { error: "risk_consent_required" }
  const decision = await recordDecision(ctx, {
    matchId,
    decision: "aplicar",
    reason: null,
    source: "usuario",
  })
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
  const { packageId } = await createApplicationPackage(
    ctx,
    decision.applicationId
  )
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

export async function loadApplyRun(
  ctx: UserContext,
  runId: string
): Promise<ApplyRunView | null> {
  const admin = getAdminClient()
  if (!admin) return null
  const { data } = await admin
    .from("apply_runs")
    .select(
      "id, application_id, ats, target_url, phase, live_view_url, last_error, approval_id, review_summary, review_screenshot_enc, sensitive_report_enc, updated_at"
    )
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
    sensitive_report_enc: string | null
    updated_at: string
  } | null
  if (!row) return null
  const { openSensitiveReportColumn } = await import("@vagapilot/browser-pool/job")
  const sensitiveReport = openSensitiveReportColumn(row.sensitive_report_enc, ctx.user.id, row.id)
  const questions =
    row.phase === "waiting_answers"
      ? ((
          await ctx.supabase
            .from("pending_questions")
            .select("id, question_text, options, proposed_from")
            .eq("application_id", row.application_id)
            .eq("user_id", ctx.user.id)
            .eq("status", "aberta")
        ).data ?? [])
      : []
  const host = safeHost(row.target_url)
  const [levels, recipe] = await Promise.all([
    loadSiteRiskLevels(),
    host
      ? admin
          .from("ats_recipes")
          .select("status")
          .in("domain", [host, host.replace(/^www\./, "")])
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ])
  const siteRisk = host ? siteRiskLevel(host, levels) : null
  const reviewFields = row.review_summary?.fields ?? []
  const lowConfidence = reviewFields.filter(isLowConfidenceField).map((f) => f.label)
  const mapped = (
    questions as {
      id: string
      question_text: string
      options: unknown
      proposed_from: unknown
    }[]
  ).map((q) => {
    const meta = consentMeta(q.proposed_from)
    const pf = (q.proposed_from ?? {}) as {
      permission?: boolean
      consent?: boolean
      action?: string
      host?: string
      categories?: string[]
      missing?: string[]
    }
    const options = Array.isArray(q.options) ? q.options.map(String) : []
    const card =
      (pf.permission || pf.consent) && pf.action && options.includes("Permitir uma vez")
        ? { action: pf.action, host: pf.host ?? null, categories: pf.categories ?? [], missing: pf.missing ?? [] }
        : null
    return {
      card,
      id: q.id,
      question: q.question_text,
      options: Array.isArray(q.options) ? q.options.map(String) : [],
      consent: meta ? { termsUrl: meta.terms_url ?? null } : null,
    }
  })
  const alerts = riskAlerts({
    siteLevel: siteRisk,
    consentPending: mapped.some((q) => q.consent),
    creatingAccount: row.phase === "login_required",
    recipeStatus: (recipe.data as { status?: string } | null)?.status ?? null,
    lowConfidence: row.phase === "review_ready" ? lowConfidence.length : 0,
    atReview: row.phase === "review_ready",
  })
  return {
    id: row.id,
    applicationId: row.application_id,
    ats: row.ats,
    targetUrl: row.target_url,
    phase: row.phase,
    liveViewUrl: [
      "running",
      "login_required",
      "captcha",
      "submitting",
    ].includes(row.phase)
      ? row.live_view_url
      : null,
    lastError: row.last_error,
    approvalId: row.approval_id,
    reviewFields,
    hasScreenshot: Boolean(row.review_screenshot_enc),
    questions: mapped,
    lowConfidence,
    siteRisk,
    alerts,
    sensitiveReport,
    updatedAt: row.updated_at,
  }
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

export async function loadRunScreenshot(
  ctx: UserContext,
  runId: string
): Promise<Buffer | null> {
  const admin = getAdminClient()
  if (!admin) return null
  const { data } = await admin
    .from("apply_runs")
    .select("review_screenshot_enc")
    .eq("id", runId)
    .eq("user_id", ctx.user.id)
    .maybeSingle()
  const b64 = await openColumnText(
    ctx.user.id,
    (data as { review_screenshot_enc?: string } | null)?.review_screenshot_enc
  )
  return b64 ? Buffer.from(b64, "base64") : null
}

/** Moves a paused run back to the queue (answers given, login/captcha solved). */
export async function resumeApplyRun(
  userId: string,
  filter: { runId?: string; applicationId?: string }
): Promise<string | null> {
  const admin = getAdminClient()
  if (!admin) return null
  if (!(await cloudApplyConsent(userId)).ok) return null
  let query = admin
    .from("apply_runs")
    .update({
      phase: "queued",
      lease_until: null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .in("phase", ["waiting_answers", "login_required", "captcha"])
  if (filter.runId) query = query.eq("id", filter.runId)
  if (filter.applicationId)
    query = query.eq("application_id", filter.applicationId)
  const { data } = await query.select("id").maybeSingle()
  const runId = (data as { id: string } | null)?.id ?? null
  if (runId) await kickApplyRun(runId)
  return runId
}

/** Called by decideApproval for kind submeter_formulario. */
export async function onSubmitApprovalDecided(
  userId: string,
  approvalId: string,
  approved: boolean
): Promise<void> {
  const admin = getAdminClient()
  if (!admin) return
  if (approved && !(await cloudApplyConsent(userId)).ok) approved = false
  const { data } = await admin
    .from("apply_runs")
    .update({
      phase: approved ? "submit_approved" : "cancelled",
      lease_until: null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("approval_id", approvalId)
    .eq("phase", "review_ready")
    .select("id")
    .maybeSingle()
  const runId = (data as { id: string } | null)?.id
  if (runId && approved) await kickApplyRun(runId)
}

export async function cancelApplyRun(
  userId: string,
  runId: string
): Promise<boolean> {
  const admin = getAdminClient()
  if (!admin) return false
  const { data } = await admin
    .from("apply_runs")
    .update({
      phase: "cancelled",
      lease_until: null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("id", runId)
    .in("phase", ACTIVE)
    .select("id")
    .maybeSingle()
  return Boolean(data)
}

/** Revocation of the risk acceptance: every active cloud run of the user is cancelled. */
export async function cancelActiveApplyRuns(userId: string): Promise<number> {
  const admin = getAdminClient()
  if (!admin) return 0
  const { data } = await admin
    .from("apply_runs")
    .update({
      phase: "cancelled",
      lease_until: null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .in("phase", ACTIVE)
    .select("id")
  return (data ?? []).length
}
