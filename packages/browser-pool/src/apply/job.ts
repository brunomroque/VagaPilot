import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import {
  applicationPackagePayloadSchema,
  type ApplicationPackagePayload,
} from "@vagapilot/core/application-package"
import { logAudit } from "@vagapilot/core/audit"
import {
  createFieldCrypto,
  keyProviderFromEnv,
  type FieldCrypto,
} from "@vagapilot/core/crypto"
import { termsSnapshotHash } from "@vagapilot/core/legal"
import {
  categoriesForLabels,
  consentActionFor,
  cardChoicesFor,
  CARD_CHOICES,
} from "@vagapilot/core/permissions"
import {
  buildSensitiveReport,
  categoryCounts,
  mergeReports,
  shouldNotifySensitive,
  type ReportField,
  type ReportOrigin,
  type SensitiveReport,
} from "@vagapilot/core/sensitive-report"
import {
  authStateKeyFromEnv,
  openAuthState,
  sealAuthState,
} from "../auth/crypto.js"
import {
  decide,
  EMPTY_PERMISSIONS,
  loadPermissionState,
  PERMISSION_ALLOW,
  PERMISSION_DENY,
  permissionLabel,
  recordPermissionUse,
  sensitiveReportAad,
  type PermissionState,
} from "./permissions.js"
import { checkTransition, type ApplicationStatus } from "@vagapilot/core/status"
import {
  fromBytea,
  SupabaseAuditSink,
  SupabaseDekStore,
  toBytea,
} from "@vagapilot/db/server"
import type { Browser, BrowserContext } from "playwright-core"

import {
  acquireTrackedBrowser,
  isPoolEnabled,
  type PoolRuntime,
  type TrackedBrowser,
} from "../pool/supabase.js"
import type { BrowserProviderAdapter, ProviderConfig } from "../pool/types.js"
import { applyStorageState } from "../auth/login-job.js"
import {
  authSealerFromEnv,
  listAuthStates,
  markAuthExpired,
  pickAuthState,
  saveAuthState,
  siteOf,
  type AuthSealer,
  type AuthStateRow,
  type StorageState,
} from "../auth/state.js"
import { getCredential, saveNewCredential } from "../auth/credentials.js"
import { driverForUrl, enabledDrivers } from "./drivers.js"
import { aiDriver, type ApplyPagePlanner } from "./ai-driver.js"
import { recordApplyOutcome } from "./metrics.js"
import {
  loadRecipe,
  recipeSession,
  saveRecipeRun,
  type RecipeRunResult,
  type RecipeSession,
} from "./recipes.js"
import { normalizeLabel } from "./resolver.js"
import {
  hashPreview,
  hashSummary,
  runSegment,
  type ReviewField,
  type SegmentOutcome,
  type SegmentVerification,
  type VerificationEvent,
} from "./runner.js"
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
  /** Seals/opens saved logins (defaults to AUTH_STATE_ENCRYPTION_KEY). */
  authSealer?: AuthSealer
  /**
   * Fallback for sites without a specific driver (the generic AI driver). Used only when
   * APPLY_GENERIC_AI_ENABLED=true.
   */
  genericPlanner?: ApplyPagePlanner | null
  /** Gmail-backed OTP/link reader for this user and ATS domains (null: Gmail not connected). */
  verificationFor?: (
    userId: string,
    domains: string[]
  ) => Promise<SegmentVerification | null>
  /**
   * "Dados sensíveis enviados" e-mail (opt-in, off by default). Called only when at least one
   * notable field was filled under a standing permission; the report holds only those fields.
   */
  notifySensitive?: (input: {
    userId: string
    runId: string
    applicationId: string
    report: SensitiveReport
  }) => Promise<void>
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
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function defaultConnect(cdpUrl: string): Promise<Browser> {
  const { chromium } = await import("playwright-core")
  return chromium.connectOverCDP(cdpUrl, { timeout: 45_000 })
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
  async open<T>(
    userId: string,
    column: string | null | undefined
  ): Promise<T | null> {
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
async function lease(
  admin: SupabaseClient,
  runId: string,
  ms: number
): Promise<RunRow | null> {
  const nowIso = new Date().toISOString()
  const { data } = await admin
    .from("apply_runs")
    .update({
      lease_until: new Date(Date.now() + ms).toISOString(),
      updated_at: nowIso,
    })
    .eq("id", runId)
    .in("phase", RUNNABLE_PHASES)
    .or(`lease_until.is.null,lease_until.lt.${nowIso}`)
    .select(
      "id, user_id, application_id, package_id, ats, target_url, phase, step_index, segments, approval_id, review_summary"
    )
    .maybeSingle()
  return (data as RunRow | null) ?? null
}

async function loadPayload(
  ctx: Ctx,
  run: RunRow
): Promise<ApplicationPackagePayload | null> {
  if (!run.package_id) return null
  const { data } = await ctx.admin
    .from("application_packages")
    .select("payload_enc")
    .eq("id", run.package_id)
    .eq("user_id", run.user_id)
    .maybeSingle()
  const raw = await ctx.open<unknown>(
    run.user_id,
    (data as { payload_enc?: string } | null)?.payload_enc
  )
  const parsed = applicationPackagePayloadSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

/** Answers the user gave to this application's pending questions (status respondida). */
async function loadRunAnswers(
  ctx: Ctx,
  run: RunRow
): Promise<Record<string, string>> {
  return (await loadRunAnswerMeta(ctx, run)).answers
}

async function loadRunAnswerMeta(
  ctx: Ctx,
  run: RunRow
): Promise<{
  answers: Record<string, string>
  origins: Record<string, ReportOrigin>
}> {
  const { data } = await ctx.admin
    .from("pending_questions")
    .select("question_text, answer, status, field_type, proposed_from")
    .eq("application_id", run.application_id)
    .eq("user_id", run.user_id)
    .eq("status", "respondida")
  const answers: Record<string, string> = {}
  const origins: Record<string, ReportOrigin> = {}
  for (const row of (data ?? []) as {
    question_text: string
    answer: string | null
    field_type: string | null
    proposed_from: {
      run_id?: string
      auto?: boolean
      origin?: ReportOrigin
    } | null
  }[]) {
    // Consent/permission decisions are per action: only the ones given for THIS run count.
    if (
      (row.field_type === "consent" || row.field_type === "permission") &&
      row.proposed_from?.run_id !== run.id
    )
      continue
    if (row.answer?.trim()) {
      const key = normalizeLabel(row.question_text)
      answers[key] = row.answer.trim()
      origins[key] = row.proposed_from?.auto
        ? (row.proposed_from.origin ?? "automatico")
        : "uma_vez"
    }
  }
  return { answers, origins }
}

async function downloadCv(
  ctx: Ctx,
  run: RunRow,
  payload: ApplicationPackagePayload,
  dir: string
): Promise<string | null> {
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

/** Saved login for the run's site (Playwright storageState), opened with the auth key. */
async function restoreAuth(
  sealer: AuthSealer,
  run: RunRow,
  row: AuthStateRow | null,
  context: BrowserContext
) {
  if (!row) return
  await applyStorageState(
    context,
    await sealer.open(run.user_id, row.site, row.provider, row.storage_enc)
  )
}

/** Refreshes the saved login after each segment (cookies rotate). Needs AUTH_STATE_ENCRYPTION_KEY. */
async function persistAuth(
  ctx: Ctx,
  sealer: AuthSealer,
  hasKey: boolean,
  run: RunRow,
  context: BrowserContext,
  provider: string,
  nativeRef: string | null
) {
  const site = siteOf(run.target_url)
  const state = (await context
    .storageState()
    .catch(() => null)) as StorageState | null
  if (!state?.cookies?.some((c) => c.domain.replace(/^\./, "").endsWith(site)))
    return
  if (hasKey) {
    await saveAuthState(ctx.admin, sealer, {
      userId: run.user_id,
      site,
      provider,
      state,
      nativeRef,
    }).catch(() => undefined)
    return
  }
  // No AUTH_STATE_ENCRYPTION_KEY: keep the legacy behaviour (cookies sealed with the user DEK).
  const cookies = state.cookies.filter((c) =>
    c.domain.replace(/^\./, "").endsWith(site)
  )
  await ctx.admin.from("browser_auth_states").upsert(
    {
      user_id: run.user_id,
      site,
      provider: "legacy",
      storage_enc: await ctx.seal(run.user_id, { cookies }),
      status: "active",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,site,provider" }
  )
}

async function audit(
  ctx: Ctx,
  userId: string,
  action:
    | "apply.run_started"
    | "apply.run_paused"
    | "approval.requested"
    | "application.submitted"
    | "question.asked"
    | "apply.verification_code_used"
    | "apply.verification_link_opened"
    | "apply.verification_escalated"
    | "apply.site_account_created"
    | "apply.site_login"
    | "apply.consent_requested"
    | "agent_permission.auto_used",
  runId: string,
  details: Record<string, unknown>
) {
  await logAudit(new SupabaseAuditSink(ctx.admin), {
    userId,
    actor: "worker",
    action,
    targetType: "apply_run",
    targetId: runId,
    details,
  }).catch(() => undefined)
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ""
  }
}

function siteHost(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ""
  }
}

/** Only http(s) links on the run's own site (same host or a parent/sub domain of it). */
function safeTermsUrl(href: string | null, site: string): string | null {
  if (!href) return null
  try {
    const u = new URL(href)
    if (!/^https?:$/.test(u.protocol)) return null
    const host = u.hostname.toLowerCase()
    const base = site.split(".").slice(-2).join(".")
    return base && (host === base || host.endsWith(`.${base}`))
      ? u.toString()
      : null
  } catch {
    return null
  }
}

/** SHA-256 of the terms page text at the moment we asked (best effort, 5 s, 1 MB). */
async function snapshotTerms(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    const body = (await res.text()).slice(0, 1_000_000)
    const text = body.replace(
      /<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/gi,
      " "
    )
    return termsSnapshotHash(text)
  } catch {
    return null
  }
}

/**
 * Stores the questions the user must answer. Consent boxes covered by a standing permission (with
 * every data category confirmed) are answered here and logged; returns how many still need the
 * user, or a failure when a deny rule blocks a required consent.
 */
async function askQuestions(
  ctx: Ctx,
  run: RunRow,
  outcome: Extract<SegmentOutcome, { kind: "needs_answers" }>,
  perms: PermissionState = EMPTY_PERMISSIONS
): Promise<{ asked: number; failed?: string }> {
  const { data } = await ctx.admin
    .from("pending_questions")
    .select("question_text")
    .eq("application_id", run.application_id)
    .eq("user_id", run.user_id)
    .eq("status", "aberta")
  const open = new Set(
    ((data ?? []) as { question_text: string }[]).map((r) =>
      normalizeLabel(r.question_text)
    )
  )
  const site = siteHost(run.target_url)
  const host = hostOf(run.target_url)
  const fresh = outcome.questions.filter(
    (q) => !open.has(normalizeLabel(q.label))
  )
  let failed: string | undefined
  let autoCount = 0
  const rows = (
    await Promise.all(
      fresh.map(async (q) => {
        if (q.permission) {
          const d = decide(perms, q.permission.action, host, ["contato"])
          return {
            user_id: run.user_id,
            application_id: run.application_id,
            question_text: q.label.slice(0, 500),
            field_type: "permission",
            options: cardChoicesFor({
              action: q.permission.action,
              siteRisk: perms.siteRisk,
            }).map((c) => CARD_CHOICES[c]),
            proposed_from: {
              permission: true,
              action: q.permission.action,
              run_id: run.id,
              site,
              host,
              categories: ["contato"],
              missing: d.missing ?? [],
              reason: d.reason,
            },
            status: "aberta",
          }
        }
        if (!q.consent)
          return {
            user_id: run.user_id,
            application_id: run.application_id,
            question_text: q.label.slice(0, 500),
            field_type: q.kind,
            options: q.options.length ? q.options : null,
            status: "aberta",
          }
        // Terms/privacy/consent of the site: the user decides, or a standing permission does.
        const termsUrl = safeTermsUrl(q.consent.termsUrl, site)
        const termsSha = termsUrl ? await snapshotTerms(termsUrl) : null
        const { action, categories } = consentActionFor(q.label)
        const d = decide(perms, action, host, categories)
        const meta = {
          consent: true,
          run_id: run.id,
          site,
          host,
          action,
          categories,
          terms_url: termsUrl,
          terms_sha256: termsSha,
        }
        if (d.decision !== "ask") {
          await recordPermissionUse(ctx.admin, {
            user_id: run.user_id,
            run_id: run.id,
            action_type: action,
            site: host,
            decision: d.decision,
            reason: d.reason,
            rule_id: d.rule?.id ?? null,
            categories,
            field_label: q.label.slice(0, 300),
            terms_url: termsUrl,
            terms_sha256: termsSha,
          })
          await audit(ctx, run.user_id, "agent_permission.auto_used", run.id, {
            action,
            site: host,
            decision: d.decision,
            reason: d.reason,
            categories,
          })
        }
        if (d.decision === "deny") {
          failed = `Bloqueado pelas suas Permissões do agente (${action === "accept_marketing_optin" ? "marketing" : "termos"} negados em ${host}). Ajuste em Configurações → Permissões do agente.`
          return null
        }
        if (d.decision === "allow") {
          autoCount += 1
          await ctx.admin
            .from("apply_consent_decisions")
            .insert({
              user_id: run.user_id,
              application_id: run.application_id,
              site,
              field_label: q.label.slice(0, 500),
              terms_url: termsUrl,
              terms_sha256: termsSha,
              decision: "aceito",
            })
            .then(
              () => undefined,
              () => undefined
            )
          return {
            user_id: run.user_id,
            application_id: run.application_id,
            question_text: q.label.slice(0, 500),
            field_type: "consent",
            options: ["Aceito", "Cancelar"],
            answer: "Aceito",
            proposed_from: {
              ...meta,
              auto: true,
              origin: d.reason === "allow_rule" ? "regra" : "automatico",
              rule_id: d.rule?.id ?? null,
            },
            status: "respondida",
          }
        }
        return {
          user_id: run.user_id,
          application_id: run.application_id,
          question_text: q.label.slice(0, 500),
          field_type: "consent",
          options: cardChoicesFor({ action, siteRisk: perms.siteRisk }).map(
            (c) => CARD_CHOICES[c]
          ),
          proposed_from: {
            ...meta,
            missing: d.missing ?? [],
            reason: d.reason,
          },
          status: "aberta",
        }
      })
    )
  ).filter((r): r is NonNullable<typeof r> => r !== null)
  if (rows.length) await ctx.admin.from("pending_questions").insert(rows)
  const asked = rows.filter((r) => r.status === "aberta").length
  if (asked)
    await audit(ctx, run.user_id, "question.asked", run.id, { count: asked })
  const consents = rows.filter(
    (r) => r.field_type === "consent" && r.status === "aberta"
  )
  if (consents.length)
    await audit(ctx, run.user_id, "apply.consent_requested", run.id, {
      site,
      count: consents.length,
    })
  void autoCount
  return { asked, failed }
}

async function requestApproval(
  ctx: Ctx,
  run: RunRow,
  outcome: Extract<SegmentOutcome, { kind: "review" }>
) {
  const { data: app } = await ctx.admin
    .from("applications")
    .select("company, role_title")
    .eq("id", run.application_id)
    .maybeSingle()
  const application = app as {
    company: string | null
    role_title: string | null
  } | null
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
  await audit(ctx, run.user_id, "approval.requested", run.id, {
    approval_id: approvalId,
  })
  return approvalId
}

/** final_submit under a confirmed standing permission: approve the exact preview just created. */
async function autoApproveSubmit(
  ctx: Ctx,
  run: RunRow,
  approvalId: string,
  reason: string,
  ruleId?: string
) {
  await ctx.admin
    .from("approvals")
    .update({
      status: "aprovada",
      decided_at: new Date().toISOString(),
      decided_via: "agent_permission",
    })
    .eq("id", approvalId)
    .eq("user_id", run.user_id)
    .eq("status", "pendente")
  await ctx.update(run.id, {
    phase: "submit_approved",
    approval_id: approvalId,
  })
  await audit(ctx, run.user_id, "agent_permission.auto_used", run.id, {
    action: "final_submit",
    approval_id: approvalId,
    reason,
    rule_id: ruleId ?? null,
  })
}

async function loadSensitiveReport(
  ctx: Ctx,
  run: RunRow,
  key: Buffer | null
): Promise<SensitiveReport | null> {
  if (!key) return null
  const { data } = await ctx.admin
    .from("apply_runs")
    .select("sensitive_report_enc")
    .eq("id", run.id)
    .maybeSingle()
  const bytes = fromBytea(
    (data as { sensitive_report_enc?: string | null } | null)
      ?.sensitive_report_enc
  )
  if (!bytes) return null
  try {
    return openAuthState<SensitiveReport>(
      key,
      sensitiveReportAad(run.user_id, run.id),
      bytes
    )
  } catch {
    return null
  }
}

/** Owner-only report sealed at rest; admins only ever read sensitive_counts. */
async function saveSensitiveReport(
  ctx: Ctx,
  run: RunRow,
  key: Buffer | null,
  report: SensitiveReport
) {
  await ctx.update(run.id, {
    sensitive_counts: categoryCounts(report),
    ...(key
      ? {
          sensitive_report_enc: toBytea(
            sealAuthState(key, sensitiveReportAad(run.user_id, run.id), report)
          ),
        }
      : {}),
  })
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
  const row = data as {
    status: string
    kind: string
    preview: Record<string, unknown>
    preview_sha256: string
    expires_at: string
  } | null
  if (!row || row.status !== "aprovada" || row.kind !== "submeter_formulario")
    return null
  if (new Date(row.expires_at).getTime() < Date.now()) return null
  const sha = hashPreview(row.preview)
  if (sha !== row.preview_sha256) return null
  const hash = row.preview.summary_hash
  return typeof hash === "string" ? hash : null
}

async function markSubmitted(
  ctx: Ctx,
  run: RunRow,
  outcome: Extract<SegmentOutcome, { kind: "submitted" }>
) {
  const { data } = await ctx.admin
    .from("applications")
    .select("status")
    .eq("id", run.application_id)
    .eq("user_id", run.user_id)
    .maybeSingle()
  const current =
    (data as { status: ApplicationStatus } | null)?.status ?? "em_andamento"
  const evidence = await ctx.admin
    .from("evidences")
    .insert({
      user_id: run.user_id,
      application_id: run.application_id,
      kind: "protocol_text",
      text_excerpt: (
        outcome.confirmation ?? "Candidatura enviada pelo navegador na nuvem."
      ).slice(0, 2000),
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
      .update({
        status: "enviada",
        applied_at: new Date().toISOString(),
        route: "autonomo",
      })
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
      payload: {
        via: "cloud_browser",
        apply_run_id: run.id,
        protocol: outcome.confirmation,
      },
      evidence_id: (evidence.data as { id: string } | null)?.id ?? null,
    })
  }
  await ctx.update(run.id, {
    phase: "submitted",
    submitted_at: new Date().toISOString(),
    review_screenshot_enc: await ctx.sealBytes(run.user_id, outcome.screenshot),
    lease_until: null,
    last_error:
      check.ok || current === "enviada"
        ? null
        : `status_transition:${check.ok ? "" : check.reason}`,
  })
  await audit(ctx, run.user_id, "application.submitted", run.id, {
    via: "cloud_browser",
  })
}

export type ApplyJobResult = {
  runId: string
  phase: ApplyRunPhase | "skipped"
  segments: number
}

/**
 * Drives one apply run until it needs the user, is submitted, fails or the invocation budget
 * ends. Each segment uses a fresh cloud browser (failover across providers) and persists cookies.
 */
export async function runApplyJob(
  runId: string,
  options: ApplyJobOptions = {}
): Promise<ApplyJobResult> {
  const env = options.env ?? process.env
  const admin = options.admin ?? adminFromEnv(env)
  const crypto =
    options.crypto ??
    createFieldCrypto({
      keyProvider: keyProviderFromEnv(env),
      dekStore: new SupabaseDekStore(admin),
    })
  const ctx = new Ctx(admin, crypto)
  const sealer =
    options.authSealer ??
    authSealerFromEnv(env, async (userId, bytes) =>
      JSON.parse(await crypto.decryptFieldText(userId, bytes))
    )
  const hasAuthKey =
    Boolean(options.authSealer) ||
    Boolean(env.AUTH_STATE_ENCRYPTION_KEY?.trim())
  const budgetMs = options.budgetMs ?? 14 * 60_000
  const segmentMs = options.segmentMs ?? 14 * 60_000
  const startedAt = Date.now()
  const run = await lease(admin, runId, budgetMs + 60_000)
  if (!run) return { runId, phase: "skipped", segments: 0 }
  if (!isPoolEnabled(env) && !options.adapterFor) {
    await ctx.update(run.id, {
      phase: "failed",
      last_error: "BROWSER_POOL_ENABLED não está ativo.",
      lease_until: null,
    })
    return { runId, phase: "failed", segments: 0 }
  }
  const specific = driverForUrl(
    run.target_url,
    options.drivers ?? enabledDrivers(env)
  )
  const siteKey = siteOf(run.target_url)
  let recipe: Awaited<ReturnType<typeof loadRecipe>> = null
  let session: RecipeSession | null = null
  let generic: AtsDriver | null = null
  if (
    !specific &&
    env.APPLY_GENERIC_AI_ENABLED === "true" &&
    options.genericPlanner
  ) {
    recipe = await loadRecipe(admin, siteKey).catch(() => null)
    // Disabled by an admin: AI only, nothing replayed nor saved.
    session = recipeSession(
      recipe?.status === "disabled" ? null : recipe,
      options.genericPlanner
    )
    const candidate = aiDriver({ planner: session.planner })
    generic = candidate.detect(run.target_url) ? candidate : null
  }
  const driver = specific ?? generic
  let recipeResult: RecipeRunResult = "neutral"
  let recorded = { calls: 0, tokens: 0, replayed: 0 }
  const driverKind = specific ? "specific" : "generic_ai"
  const payload = await loadPayload(ctx, run)
  if (!driver || !payload) {
    await ctx.update(run.id, {
      phase: "failed",
      last_error: driver
        ? "Pacote da candidatura expirou ou é inválido."
        : "ATS não suportado para envio na nuvem.",
      lease_until: null,
    })
    return { runId, phase: "failed", segments: 0 }
  }
  await audit(ctx, run.user_id, "apply.run_started", run.id, {
    ats: driver.ats,
    phase: run.phase,
  })
  const dir = await mkdtemp(join(tmpdir(), "vp-apply-"))
  let segments = run.segments
  let phase: ApplyRunPhase = run.phase
  try {
    const cvPath = await downloadCv(ctx, run, payload, dir)
    const runtime: PoolRuntime = { admin, env, adapterFor: options.adapterFor }
    const exclude: string[] = []
    const site = siteOf(run.target_url)
    const savedLogin = pickAuthState(
      await listAuthStates(admin, run.user_id, site).catch(() => [])
    )
    // Only the run's own ATS domain (and the posting host) may send codes/links we act on.
    const verifyDomains = [...new Set([site, new URL(run.target_url).hostname])]
    const verification = options.verificationFor
      ? await options
          .verificationFor(run.user_id, verifyDomains)
          .catch(() => null)
      : null
    const host = hostOf(run.target_url)
    const perms = await loadPermissionState(admin, run.user_id, host).catch(
      () => EMPTY_PERMISSIONS
    )
    const reportKey = (() => {
      try {
        return authStateKeyFromEnv(env)
      } catch {
        return null
      }
    })()
    let report = await loadSensitiveReport(ctx, run, reportKey)
    let answerMeta = await loadRunAnswerMeta(ctx, run)
    const permit = async (
      action: "create_site_account" | "open_email_link" | "use_email_code"
    ): Promise<"allow" | "ask" | "deny"> => {
      const d = decide(perms, action, host, ["contato"])
      if (d.decision !== "ask") {
        await recordPermissionUse(admin, {
          user_id: run.user_id,
          run_id: run.id,
          action_type: action,
          site: host,
          decision: d.decision,
          reason: d.reason,
          rule_id: d.rule?.id ?? null,
          categories: ["contato"],
        })
        await audit(ctx, run.user_id, "agent_permission.auto_used", run.id, {
          action,
          site: host,
          decision: d.decision,
          reason: d.reason,
        })
        return d.decision
      }
      const given = answerMeta.answers[normalizeLabel(permissionLabel(action))]
      if (given === PERMISSION_ALLOW) return "allow"
      if (given === PERMISSION_DENY) return "deny"
      return "ask"
    }
    let autoRounds = 0
    const accountEmail = payload.profile.email
    const account =
      hasAuthKey && accountEmail
        ? {
            async get() {
              const found = await getCredential(admin, run.user_id, site, env)
              return found
                ? {
                    email: found.email,
                    password: found.password,
                    created: false,
                  }
                : null
            },
            async create() {
              const saved = await saveNewCredential(
                admin,
                run.user_id,
                site,
                accountEmail,
                env
              )
              await audit(
                ctx,
                run.user_id,
                "apply.site_account_created",
                run.id,
                {
                  site,
                }
              )
              return {
                email: saved.email,
                password: saved.password,
                created: true,
              }
            },
          }
        : null
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
          // The provider that holds the native login (Context/Profile) goes first.
          prefer: savedLogin?.native_ref
            ? [savedLogin.provider as ProviderConfig["provider"]]
            : undefined,
          async beforeCreate(config) {
            if (
              !savedLogin?.native_ref ||
              config.provider !== savedLogin.provider
            )
              return
            return {
              persistence: {
                [config.provider]: { ref: savedLogin.native_ref, save: true },
              },
            }
          },
        })
      } catch (error) {
        phase = "failed"
        await ctx.update(run.id, {
          phase,
          last_error:
            error instanceof Error
              ? error.message.slice(0, 400)
              : "Sem navegador disponível.",
          lease_until: null,
        })
        return { runId, phase, segments }
      }
      segments += 1
      const submitHash =
        run.phase === "submit_approved" ? await approvedHash(ctx, run) : null
      await ctx.update(run.id, {
        phase: submitHash ? "submitting" : "running",
        provider_id: tracked.config.id === "local" ? null : tracked.config.id,
        live_view_url: tracked.session.liveViewUrl,
        segments,
        last_error: null,
      })
      let outcome: SegmentOutcome
      let browser: Browser | null = null
      const segmentStarted = Date.now()
      try {
        browser = await (options.connect ?? defaultConnect)(
          tracked.session.cdpUrl
        )
        const context = browser.contexts()[0] ?? (await browser.newContext())
        await restoreAuth(sealer, run, savedLogin, context)
        const page = context.pages()[0] ?? (await context.newPage())
        if (!tracked.session.liveViewUrl && tracked.adapter.liveViewFromCdp) {
          const cdp = await context.newCDPSession(page)
          const live = await tracked.adapter
            .liveViewFromCdp(
              (method, params) =>
                cdp.send(method as never, params as never) as Promise<unknown>
            )
            .catch(() => null)
          if (live) await ctx.update(run.id, { live_view_url: live })
        }
        outcome = await runSegment({
          page,
          driver,
          url: run.target_url,
          ctx: {
            payload,
            runAnswers: (answerMeta = await loadRunAnswerMeta(ctx, run))
              .answers,
            cvPath,
          },
          permit,
          deadline: Date.now() + sessionMs - 60_000,
          approvedSummaryHash: submitHash,
          humanWaitMs: options.humanWaitMs,
          onWaitingUser: async (reason) => {
            await ctx.update(run.id, {
              phase: reason === "login" ? "login_required" : "captcha",
              ...(reason === "verification"
                ? {
                    last_error:
                      "O site pediu um código ou confirmação que não chegou no Gmail (pode ser SMS). Conclua no navegador ao vivo.",
                  }
                : {}),
            })
          },
          verification,
          account,
          onVerification: async (event: VerificationEvent) => {
            const action =
              event.kind === "code_used"
                ? "apply.verification_code_used"
                : event.kind === "link_opened"
                  ? "apply.verification_link_opened"
                  : event.kind === "escalated"
                    ? "apply.verification_escalated"
                    : "apply.site_login"
            // Metadata only: message id, code length, link host. Never the code/link/password.
            await audit(ctx, run.user_id, action, run.id, { ...event, site })
          },
          onAuthenticated: async () => {
            await persistAuth(
              ctx,
              sealer,
              hasAuthKey,
              run,
              context,
              tracked.config.provider,
              savedLogin?.provider === tracked.config.provider
                ? (savedLogin?.native_ref ?? null)
                : null
            ).catch(() => undefined)
          },
          onProgress: async (step, filled) => {
            const fields: ReportField[] = filled.map((f) => ({
              question: f.label,
              answer: f.value,
              origin:
                f.source === "run_answer"
                  ? (answerMeta.origins[normalizeLabel(f.label)] ?? "uma_vez")
                  : "perfil",
              confidence: f.confidence ?? null,
            }))
            const next = buildSensitiveReport(host, fields)
            if (next.entries.length) {
              report = mergeReports(report, next)
              await saveSensitiveReport(ctx, run, reportKey, report)
            }
            await ctx.update(run.id, {
              step_index: step,
              phase: submitHash ? "submitting" : "running",
            })
          },
        })
        const sameProvider = savedLogin?.provider === tracked.config.provider
        await persistAuth(
          ctx,
          sealer,
          hasAuthKey,
          run,
          context,
          tracked.config.provider,
          sameProvider ? (savedLogin?.native_ref ?? null) : null
        )
      } catch (error) {
        outcome = {
          kind: "failed",
          code: "connect_failed",
          message:
            error instanceof Error
              ? error.message.slice(0, 300)
              : "connect failed",
        }
        exclude.push(tracked.config.id)
      } finally {
        await browser?.close().catch(() => undefined)
      }
      await recordApplyOutcome(admin, {
        run_id: run.id,
        user_id: run.user_id,
        ats: driver.ats,
        driver: driverKind,
        site,
        outcome:
          outcome.kind === "waiting_user"
            ? `waiting_${outcome.reason}`
            : outcome.kind,
        code: outcome.kind === "failed" ? outcome.code : null,
        duration_ms: Date.now() - segmentStarted,
        llm_calls: (session?.stats.llmCalls ?? 0) - recorded.calls,
        llm_tokens: (session?.stats.llmTokens ?? 0) - recorded.tokens,
        replayed_steps: (session?.stats.replayedSteps ?? 0) - recorded.replayed,
      })
      if (session)
        recorded = {
          calls: session.stats.llmCalls,
          tokens: session.stats.llmTokens,
          replayed: session.stats.replayedSteps,
        }
      if (outcome.kind === "review" || outcome.kind === "submitted")
        recipeResult = "success"
      else if (outcome.kind === "failed" && outcome.code !== "connect_failed")
        recipeResult = "failure"
      await tracked.finish(
        outcome.kind === "failed"
          ? { code: outcome.code, message: outcome.message }
          : undefined
      )

      switch (outcome.kind) {
        case "continue":
          continue
        case "needs_answers":
          {
            const asked = await askQuestions(ctx, run, outcome, perms)
            if (asked.failed) {
              phase = "failed"
              await ctx.update(run.id, {
                phase,
                last_error: asked.failed,
                lease_until: null,
                live_view_url: null,
              })
              return { runId, phase, segments }
            }
            // Everything covered by standing permissions: keep going without pausing.
            if (asked.asked === 0 && autoRounds++ < 3) continue
          }
          phase = "waiting_answers"
          await ctx.update(run.id, {
            phase,
            lease_until: null,
            live_view_url: null,
          })
          return { runId, phase, segments }
        case "waiting_user":
          phase = outcome.reason === "login" ? "login_required" : "captcha"
          // The saved login (if any) no longer works: the chat offers "Conectar site".
          if (outcome.reason === "login")
            await markAuthExpired(admin, run.user_id, site).catch(
              () => undefined
            )
          // The browser is closed now: drop its live view so the UI offers a fresh login.
          await ctx.update(run.id, {
            phase,
            lease_until: null,
            ...(outcome.reason === "login" ? { live_view_url: null } : {}),
          })
          await audit(ctx, run.user_id, "apply.run_paused", run.id, {
            reason: outcome.reason,
          })
          return { runId, phase, segments }
        case "review":
          phase = "review_ready"
          {
            const approvalId = await requestApproval(ctx, run, outcome)
            const d = decide(
              perms,
              "final_submit",
              host,
              categoriesForLabels(outcome.summary.map((f) => f.label))
            )
            if (d.decision === "allow" && approvalId && autoRounds++ < 4) {
              await autoApproveSubmit(
                ctx,
                run,
                approvalId,
                d.reason,
                d.rule?.id
              )
              await recordPermissionUse(admin, {
                user_id: run.user_id,
                run_id: run.id,
                action_type: "final_submit",
                site: host,
                decision: "allow",
                reason: d.reason,
                rule_id: d.rule?.id ?? null,
              })
              run.phase = "submit_approved"
              run.approval_id = approvalId
              continue
            }
          }
          return { runId, phase, segments }
        case "submitted":
          phase = "submitted"
          await markSubmitted(ctx, run, outcome)
          if (report && options.notifySensitive) {
            const { data: prefs } = await admin
              .from("agent_permission_prefs")
              .select("notify_sensitive_email")
              .eq("user_id", run.user_id)
              .maybeSingle()
            const optIn = Boolean(
              (prefs as { notify_sensitive_email?: boolean } | null)
                ?.notify_sensitive_email
            )
            if (shouldNotifySensitive(report, optIn))
              await options
                .notifySensitive({
                  userId: run.user_id,
                  runId: run.id,
                  applicationId: run.application_id,
                  report: {
                    ...report,
                    entries: report.entries.filter(
                      (e) => e.origin === "regra" || e.origin === "automatico"
                    ),
                  },
                })
                .catch(() => undefined)
          }
          return { runId, phase, segments }
        case "failed":
          if (
            outcome.code === "connect_failed" &&
            Date.now() - startedAt < budgetMs - 120_000
          )
            continue
          phase = "failed"
          await ctx.update(run.id, {
            phase,
            last_error: outcome.message,
            lease_until: null,
            live_view_url: null,
          })
          return { runId, phase, segments }
      }
    }
    // Budget over mid-run: release the lease and enqueue the next invocation.
    phase = run.phase === "submit_approved" ? "submit_approved" : "queued"
    await ctx.update(run.id, { phase, lease_until: null })
    await options.requeue?.(run.id)
    return { runId, phase, segments }
  } finally {
    if (session && generic && recipe?.status !== "disabled")
      await saveRecipeRun(admin, {
        domain: siteKey,
        platform: generic.ats,
        recipe,
        session,
        result: recipeResult,
      })
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}

export { hashSummary }

/**
 * Opens a run's sealed "Dados sensíveis enviados" report (owner views only). Returns null
 * without the key or on any tampering.
 */
export function openSensitiveReportColumn(
  value: string | null | undefined,
  userId: string,
  runId: string,
  env: Env = process.env
): SensitiveReport | null {
  try {
    const key = authStateKeyFromEnv(env)
    const bytes = fromBytea(value)
    if (!key || !bytes) return null
    return openAuthState<SensitiveReport>(
      key,
      sensitiveReportAad(userId, runId),
      bytes
    )
  } catch {
    return null
  }
}
