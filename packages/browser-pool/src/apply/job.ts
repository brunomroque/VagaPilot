import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import {
  applicationPackagePayloadSchema,
  type ApplicationPackagePayload,
} from "@vagapilot/core/application-package"
import { logAudit } from "@vagapilot/core/audit"
import { createFieldCrypto, keyProviderFromEnv, type FieldCrypto } from "@vagapilot/core/crypto"
import { checkTransition, type ApplicationStatus } from "@vagapilot/core/status"
import { fromBytea, SupabaseAuditSink, SupabaseDekStore, toBytea } from "@vagapilot/db/server"
import type { Browser, BrowserContext } from "playwright-core"

import { acquireTrackedBrowser, isPoolEnabled, type PoolRuntime, type TrackedBrowser } from "../pool/supabase.js"
import type { BrowserProviderAdapter, ProviderConfig } from "../pool/types.js"
import { driverForUrl, enabledDrivers } from "./drivers.js"
import { normalizeLabel } from "./resolver.js"
import { hashPreview, hashSummary, runSegment, type ReviewField, type SegmentOutcome } from "./runner.js"
import type { AtsDriver } from "./types.js"

type Env = Record<string, string | undefined>

export type ApplyRunPhase =
  | "queued"
  | "running"
  | "login_required"
  | "waiting_answers"
  | "captcha"
  | "review_ready"
  | "submit_approved"
  | "submitting"
  | "submitted"
  | "failed"
  | "cancelled"

/** Phases a worker may pick up. */
export const RUNNABLE_PHASES: ApplyRunPhase[] = ["queued", "submit_approved"]

export type ApplyJobOptions = {
  env?: Env
  admin?: SupabaseClient
  crypto?: FieldCrypto
  /** Mock providers in tests / local dev. */
  adapterFor?: (config: ProviderConfig) => BrowserProviderAdapter | null
  connect?: (cdpUrl: string) => Promise<Browser>
  drivers?: AtsDriver[]
  /** Total wall-clock budget for this invocation (Netlify background: 15 min). */
  budgetMs?: number
  /** Max time per browser session; Steel free = 15 min. */
  segmentMs?: number
  humanWaitMs?: number
  /** Re-enqueue when the budget ends mid-run. */
  requeue?: (runId: string) => Promise<void>
}

type RunRow = {
  id: string
  user_id: string
  application_id: string
  package_id: string | null
  ats: string
  target_url: string
  phase: ApplyRunPhase
  step_index: number
  segments: number
  approval_id: string | null
  review_summary: { fields?: ReviewField[]; hash?: string } | null
}

export function adminFromEnv(env: Env = process.env): SupabaseClient {
  const url = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("Supabase service role is not configured")
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

async function defaultConnect(cdpUrl: string): Promise<Browser> {
  const { chromium } = await import("playwright-core")
  return chromium.connectOverCDP(cdpUrl, { timeout: 45_000 })
}

function siteOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").split(".").slice(-2).join(".")
  } catch {
    return "unknown"
  }
}

class Ctx {
  constructor(
    readonly admin: SupabaseClient,
    readonly crypto: FieldCrypto
  ) {}
  async seal(userId: string, value: unknown): Promise<string> {
    const text = typeof value === "string" ? value : JSON.stringify(value)
    return toBytea(await this.crypto.encryptField(userId, text))
  }
  async sealBytes(userId: string, bytes: Buffer): Promise<string> {
    return this.seal(userId, bytes.toString("base64"))
  }
  async open<T>(userId: string, column: string | null | undefined): Promise<T | null> {
    const bytes = fromBytea(column)
    if (!bytes) return null
    return JSON.parse(await this.crypto.decryptFieldText(userId, bytes)) as T
  }
  async update(runId: string, patch: Record<string, unknown>) {
    await this.admin
      .from("apply_runs")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", runId)
  }
}

/** Takes a lease so two workers never drive the same run. */
async function lease(admin: SupabaseClient, runId: string, ms: number): Promise<RunRow | null> {
  const nowIso = new Date().toISOString()
  const { data } = await admin
    .from("apply_runs")
    .update({ lease_until: new Date(Date.now() + ms).toISOString(), updated_at: nowIso })
    .eq("id", runId)
    .in("phase", RUNNABLE_PHASES)
    .or(`lease_until.is.null,lease_until.lt.${nowIso}`)
    .select("id, user_id, application_id, package_id, ats, target_url, phase, step_index, segments, approval_id, review_summary")
    .maybeSingle()
  return (data as RunRow | null) ?? null
}

async function loadPayload(ctx: Ctx, run: RunRow): Promise<ApplicationPackagePayload | null> {
  if (!run.package_id) return null
  const { data } = await ctx.admin
    .from("application_packages")
    .select("payload_enc")
    .eq("id", run.package_id)
    .eq("user_id", run.user_id)
    .maybeSingle()
  const raw = await ctx.open<unknown>(run.user_id, (data as { payload_enc?: string } | null)?.payload_enc)
  const parsed = applicationPackagePayloadSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

/** Answers the user gave to this application's pending questions (status respondida). */
async function loadRunAnswers(ctx: Ctx, run: RunRow): Promise<Record<string, string>> {
  const { data } = await ctx.admin
    .from("pending_questions")
    .select("question_text, answer, status")
    .eq("application_id", run.application_id)
    .eq("user_id", run.user_id)
    .eq("status", "respondida")
  const answers: Record<string, string> = {}
  for (const row of (data ?? []) as { question_text: string; answer: string | null }[]) {
    if (row.answer?.trim()) answers[normalizeLabel(row.question_text)] = row.answer.trim()
  }
  return answers
}

async function downloadCv(ctx: Ctx, run: RunRow, payload: ApplicationPackagePayload, dir: string): Promise<string | null> {
  if (!payload.cvVersionId) return null
  const { data } = await ctx.admin
    .from("cv_versions")
    .select("storage_path")
    .eq("id", payload.cvVersionId)
    .eq("user_id", run.user_id)
    .maybeSingle()
  const path = (data as { storage_path?: string } | null)?.storage_path
  if (!path) return null
  const file = await ctx.admin.storage.from("cvs").download(path)
  if (file.error || !file.data) return null
  const name = `${payload.profile.displayName.replace(/[^\p{L}\p{N} _-]/gu, "").trim() || "Curriculo"} - CV.pdf`
  const target = join(dir, name)
  await writeFile(target, Buffer.from(await file.data.arrayBuffer()))
  return target
}

async function restoreAuth(ctx: Ctx, run: RunRow, context: BrowserContext) {
  const { data } = await ctx.admin
    .from("browser_auth_states")
    .select("storage_enc")
    .eq("user_id", run.user_id)
    .eq("site", siteOf(run.target_url))
    .maybeSingle()
  const state = await ctx.open<{ cookies?: Parameters<BrowserContext["addCookies"]>[0] }>(
    run.user_id,
    (data as { storage_enc?: string } | null)?.storage_enc
  )
  if (state?.cookies?.length) await context.addCookies(state.cookies).catch(() => undefined)
}

async function persistAuth(ctx: Ctx, run: RunRow, context: BrowserContext) {
  const site = siteOf(run.target_url)
  const cookies = (await context.cookies().catch(() => [])).filter((c) => c.domain.replace(/^\./, "").endsWith(site))
  if (!cookies.length) return
  await ctx.admin.from("browser_auth_states").upsert({
    user_id: run.user_id,
    site,
    storage_enc: await ctx.seal(run.user_id, { cookies }),
    updated_at: new Date().toISOString(),
  })
}

async function audit(ctx: Ctx, userId: string, action: "apply.run_started" | "apply.run_paused" | "approval.requested" | "application.submitted" | "question.asked", runId: string, details: Record<string, unknown>) {
  await logAudit(new SupabaseAuditSink(ctx.admin), {
    userId,
    actor: "worker",
    action,
    targetType: "apply_run",
    targetId: runId,
    details,
  }).catch(() => undefined)
}

async function askQuestions(ctx: Ctx, run: RunRow, outcome: Extract<SegmentOutcome, { kind: "needs_answers" }>) {
  const { data } = await ctx.admin
    .from("pending_questions")
    .select("question_text")
    .eq("application_id", run.application_id)
    .eq("user_id", run.user_id)
    .eq("status", "aberta")
  const open = new Set(((data ?? []) as { question_text: string }[]).map((r) => normalizeLabel(r.question_text)))
  const rows = outcome.questions
    .filter((q) => !open.has(normalizeLabel(q.label)))
    .map((q) => ({
      user_id: run.user_id,
      application_id: run.application_id,
      question_text: q.label.slice(0, 500),
      field_type: q.kind,
      options: q.options.length ? q.options : null,
      status: "aberta",
    }))
  if (rows.length) await ctx.admin.from("pending_questions").insert(rows)
  await audit(ctx, run.user_id, "question.asked", run.id, { count: outcome.questions.length })
}

async function requestApproval(ctx: Ctx, run: RunRow, outcome: Extract<SegmentOutcome, { kind: "review" }>) {
  const { data: app } = await ctx.admin
    .from("applications")
    .select("company, role_title")
    .eq("id", run.application_id)
    .maybeSingle()
  const application = app as { company: string | null; role_title: string | null } | null
  const preview = {
    apply_run_id: run.id,
    company: application?.company ?? "",
    role_title: application?.role_title ?? "",
    url: run.target_url,
    fields: outcome.summary,
    summary_hash: outcome.summaryHash,
  }
  const previewSha = hashPreview(preview)
  // Expire older pending approvals of this run (the form changed).
  await ctx.admin
    .from("approvals")
    .update({ status: "expirada" })
    .eq("user_id", run.user_id)
    .eq("status", "pendente")
    .eq("kind", "submeter_formulario")
    .eq("application_id", run.application_id)
  const inserted = await ctx.admin
    .from("approvals")
    .insert({
      user_id: run.user_id,
      kind: "submeter_formulario",
      application_id: run.application_id,
      subject_ref: { apply_run_id: run.id, application_id: run.application_id },
      preview,
      preview_sha256: previewSha,
      expires_at: new Date(Date.now() + 24 * 3_600_000).toISOString(),
      status: "pendente",
    })
    .select("id")
    .single()
  const approvalId = (inserted.data as { id: string } | null)?.id ?? null
  await ctx.update(run.id, {
    phase: "review_ready",
    review_summary: { fields: outcome.summary, hash: outcome.summaryHash },
    review_screenshot_enc: await ctx.sealBytes(run.user_id, outcome.screenshot),
    approval_id: approvalId,
    lease_until: null,
  })
  await audit(ctx, run.user_id, "approval.requested", run.id, { approval_id: approvalId })
}

/** The approved hash, only if the approval is still valid and its preview is untampered. */
async function approvedHash(ctx: Ctx, run: RunRow): Promise<string | null> {
  if (!run.approval_id) return null
  const { data } = await ctx.admin
    .from("approvals")
    .select("status, kind, preview, preview_sha256, expires_at")
    .eq("id", run.approval_id)
    .eq("user_id", run.user_id)
    .maybeSingle()
  const row = data as { status: string; kind: string; preview: Record<string, unknown>; preview_sha256: string; expires_at: string } | null
  if (!row || row.status !== "aprovada" || row.kind !== "submeter_formulario") return null
  if (new Date(row.expires_at).getTime() < Date.now()) return null
  const sha = hashPreview(row.preview)
  if (sha !== row.preview_sha256) return null
  const hash = row.preview.summary_hash
  return typeof hash === "string" ? hash : null
}

async function markSubmitted(ctx: Ctx, run: RunRow, outcome: Extract<SegmentOutcome, { kind: "submitted" }>) {
  const { data } = await ctx.admin
    .from("applications")
    .select("status")
    .eq("id", run.application_id)
    .eq("user_id", run.user_id)
    .maybeSingle()
  const current = (data as { status: ApplicationStatus } | null)?.status ?? "em_andamento"
  const evidence = await ctx.admin
    .from("evidences")
    .insert({
      user_id: run.user_id,
      application_id: run.application_id,
      kind: "protocol_text",
      text_excerpt: (outcome.confirmation ?? "Candidatura enviada pelo navegador na nuvem.").slice(0, 2000),
      url: run.target_url.slice(0, 2000),
    })
    .select("id")
    .single()
  const check = checkTransition(current, "enviada", {
    source: "worker",
    confirmedByUser: true,
    hasEvidence: true,
    confidence: 0.95,
  })
  if (current !== "enviada" && check.ok) {
    await ctx.admin
      .from("applications")
      .update({ status: "enviada", applied_at: new Date().toISOString(), route: "autonomo" })
      .eq("id", run.application_id)
      .eq("user_id", run.user_id)
    await ctx.admin.from("application_events").insert({
      user_id: run.user_id,
      application_id: run.application_id,
      type: "status_change",
      from_status: current,
      to_status: "enviada",
      source: "worker",
      confidence: 0.95,
      payload: { via: "cloud_browser", apply_run_id: run.id, protocol: outcome.confirmation },
      evidence_id: (evidence.data as { id: string } | null)?.id ?? null,
    })
  }
  await ctx.update(run.id, {
    phase: "submitted",
    submitted_at: new Date().toISOString(),
    review_screenshot_enc: await ctx.sealBytes(run.user_id, outcome.screenshot),
    lease_until: null,
    last_error: check.ok || current === "enviada" ? null : `status_transition:${check.ok ? "" : check.reason}`,
  })
  await audit(ctx, run.user_id, "application.submitted", run.id, { via: "cloud_browser" })
}

export type ApplyJobResult = { runId: string; phase: ApplyRunPhase | "skipped"; segments: number }

/**
 * Drives one apply run until it needs the user, is submitted, fails or the invocation budget
 * ends. Each segment uses a fresh cloud browser (failover across providers) and persists cookies.
 */
export async function runApplyJob(runId: string, options: ApplyJobOptions = {}): Promise<ApplyJobResult> {
  const env = options.env ?? process.env
  const admin = options.admin ?? adminFromEnv(env)
  const crypto =
    options.crypto ?? createFieldCrypto({ keyProvider: keyProviderFromEnv(env), dekStore: new SupabaseDekStore(admin) })
  const ctx = new Ctx(admin, crypto)
  const budgetMs = options.budgetMs ?? 14 * 60_000
  const segmentMs = options.segmentMs ?? 14 * 60_000
  const startedAt = Date.now()
  const run = await lease(admin, runId, budgetMs + 60_000)
  if (!run) return { runId, phase: "skipped", segments: 0 }
  if (!isPoolEnabled(env) && !options.adapterFor) {
    await ctx.update(run.id, { phase: "failed", last_error: "BROWSER_POOL_ENABLED não está ativo.", lease_until: null })
    return { runId, phase: "failed", segments: 0 }
  }
  const driver = driverForUrl(run.target_url, options.drivers ?? enabledDrivers(env))
  const payload = await loadPayload(ctx, run)
  if (!driver || !payload) {
    await ctx.update(run.id, {
      phase: "failed",
      last_error: driver ? "Pacote da candidatura expirou ou é inválido." : "ATS não suportado para envio na nuvem.",
      lease_until: null,
    })
    return { runId, phase: "failed", segments: 0 }
  }
  await audit(ctx, run.user_id, "apply.run_started", run.id, { ats: driver.ats, phase: run.phase })
  const dir = await mkdtemp(join(tmpdir(), "vp-apply-"))
  let segments = run.segments
  let phase: ApplyRunPhase = run.phase
  try {
    const cvPath = await downloadCv(ctx, run, payload, dir)
    const runtime: PoolRuntime = { admin, env, adapterFor: options.adapterFor }
    const exclude: string[] = []
    while (Date.now() - startedAt < budgetMs) {
      const remaining = budgetMs - (Date.now() - startedAt)
      const sessionMs = Math.min(segmentMs, remaining)
      if (sessionMs < 60_000) break
      let tracked: TrackedBrowser
      try {
        tracked = await acquireTrackedBrowser(runtime, {
          timeoutSeconds: Math.ceil(sessionMs / 1000) + 30,
          headful: true,
          userId: run.user_id,
          applyRunId: run.id,
          exclude,
        })
      } catch (error) {
        phase = "failed"
        await ctx.update(run.id, {
          phase,
          last_error: error instanceof Error ? error.message.slice(0, 400) : "Sem navegador disponível.",
          lease_until: null,
        })
        return { runId, phase, segments }
      }
      segments += 1
      const submitHash = run.phase === "submit_approved" ? await approvedHash(ctx, run) : null
      await ctx.update(run.id, {
        phase: submitHash ? "submitting" : "running",
        provider_id: tracked.config.id,
        live_view_url: tracked.session.liveViewUrl,
        segments,
        last_error: null,
      })
      let outcome: SegmentOutcome
      let browser: Browser | null = null
      try {
        browser = await (options.connect ?? defaultConnect)(tracked.session.cdpUrl)
        const context = browser.contexts()[0] ?? (await browser.newContext())
        await restoreAuth(ctx, run, context)
        const page = context.pages()[0] ?? (await context.newPage())
        if (!tracked.session.liveViewUrl && tracked.adapter.liveViewFromCdp) {
          const cdp = await context.newCDPSession(page)
          const live = await tracked.adapter
            .liveViewFromCdp((method, params) => cdp.send(method as never, params as never) as Promise<unknown>)
            .catch(() => null)
          if (live) await ctx.update(run.id, { live_view_url: live })
        }
        outcome = await runSegment({
          page,
          driver,
          url: run.target_url,
          ctx: { payload, runAnswers: await loadRunAnswers(ctx, run), cvPath },
          deadline: Date.now() + sessionMs - 60_000,
          approvedSummaryHash: submitHash,
          humanWaitMs: options.humanWaitMs,
          onWaitingUser: async (reason) => {
            await ctx.update(run.id, { phase: reason === "login" ? "login_required" : "captcha" })
          },
          onProgress: async (step) => {
            await ctx.update(run.id, { step_index: step, phase: submitHash ? "submitting" : "running" })
          },
        })
        await persistAuth(ctx, run, context)
      } catch (error) {
        outcome = { kind: "failed", code: "connect_failed", message: error instanceof Error ? error.message.slice(0, 300) : "connect failed" }
        exclude.push(tracked.config.id)
      } finally {
        await browser?.close().catch(() => undefined)
      }
      await tracked.finish(outcome.kind === "failed" ? { code: outcome.code, message: outcome.message } : undefined)

      switch (outcome.kind) {
        case "continue":
          continue
        case "needs_answers":
          phase = "waiting_answers"
          await askQuestions(ctx, run, outcome)
          await ctx.update(run.id, { phase, lease_until: null, live_view_url: null })
          return { runId, phase, segments }
        case "waiting_user":
          phase = outcome.reason === "login" ? "login_required" : "captcha"
          await ctx.update(run.id, { phase, lease_until: null })
          await audit(ctx, run.user_id, "apply.run_paused", run.id, { reason: outcome.reason })
          return { runId, phase, segments }
        case "review":
          phase = "review_ready"
          await requestApproval(ctx, run, outcome)
          return { runId, phase, segments }
        case "submitted":
          phase = "submitted"
          await markSubmitted(ctx, run, outcome)
          return { runId, phase, segments }
        case "failed":
          if (outcome.code === "connect_failed" && Date.now() - startedAt < budgetMs - 120_000) continue
          phase = "failed"
          await ctx.update(run.id, { phase, last_error: outcome.message, lease_until: null, live_view_url: null })
          return { runId, phase, segments }
      }
    }
    // Budget over mid-run: release the lease and enqueue the next invocation.
    phase = run.phase === "submit_approved" ? "submit_approved" : "queued"
    await ctx.update(run.id, { phase, lease_until: null })
    await options.requeue?.(run.id)
    return { runId, phase, segments }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}

export { hashSummary }
