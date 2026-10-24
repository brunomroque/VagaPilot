import "server-only"

import { after } from "next/server"

import { createEmbedder } from "@vagapilot/ai"
import {
  checkTransition,
  type ApplicationStatus,
  type EventSource,
} from "@vagapilot/core/status"
import { SupabaseAuditSink } from "@vagapilot/db/server"
import {
  computeMatch,
  createIngestDeps,
  isInngestConfigured,
  POSTING_COLUMNS,
  processJobIngestion,
  runIngestionInline,
  startIngestionForUser,
  type PostingForMatch,
} from "@vagapilot/jobs"

import type { IngestItem, JobCardData, JobDecision } from "@/lib/chat/types"
import { buildApplyUrl, createApplicationPackage } from "@/lib/ext/packages"
import { createJobAnalysisUsage } from "@/lib/entitlements/server"
import { getAdminClient } from "@/lib/server/admin"
import { audit } from "@/lib/server/audit"
import type { UserContext } from "@/lib/server/context"

/*
 * Job ingestion, cards and decisions for the chat (8.4, F4, F7). Rows are created with the
 * user's RLS session; the extraction itself runs with service_role (job_postings is global)
 * either in Inngest or, without it, right after the response (`after`), so a batch shows up
 * incrementally (CA6.3).
 */

type IngestionRow = {
  id: string
  input_url: string | null
  status: IngestItem["status"]
  error_code: string | null
  job_match_id: string | null
}

function toItem(row: IngestionRow): IngestItem {
  return {
    ingestionId: row.id,
    url: row.input_url,
    status: row.status,
    errorCode: row.error_code,
    jobMatchId: row.job_match_id,
  }
}

function runInline(userId: string, ingestionIds: string[]) {
  const admin = getAdminClient()
  if (!admin) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured")
  const deps = createIngestDeps({
    admin,
    audit: new SupabaseAuditSink(admin),
    actor: "worker",
    usage: createJobAnalysisUsage(),
  })
  const work = Promise.all(
    ingestionIds.map((ingestionId) =>
      processJobIngestion(deps, { userId, ingestionId }).catch(
        (error: unknown) => {
          console.error("job ingestion failed", {
            ingestionId,
            reason: error instanceof Error ? error.message : "unknown",
          })
        }
      )
    )
  )
  after(() => work)
}

/** `ingest_job_postings` (10.3): creates one row per link (or the pasted text) and enqueues. */
export async function startIngestion(
  ctx: UserContext,
  input: {
    urls?: string[]
    text?: string
    replaceUrl?: string | null
    conversationId?: string | null
  }
): Promise<{ batchId: string; items: IngestItem[] }> {
  const result = await startIngestionForUser(ctx.supabase, ctx.user.id, {
    ...input,
    enqueueOnly: !isInngestConfigured(),
  })
  if (!isInngestConfigured()) {
    const ids = result.items.map((item) => item.ingestionId)
    after(() => runIngestionInline(ctx.user.id, ids))
  }
  return result
}

/** RF15.2: LinkedIn job alerts from Gmail sync (service context, no user session). */
export async function startIngestionFromJobAlert(input: {
  userId: string
  urls: string[]
  emailThreadId: string
}): Promise<void> {
  const admin = getAdminClient()
  if (!admin || input.urls.length === 0) return
  await startIngestionForUser(admin, input.userId, {
    urls: input.urls,
    batchId: `gmail-alert-${input.emailThreadId}`,
  })
}

const STALE_MS = 90_000

export async function loadBatch(
  ctx: UserContext,
  batchId: string
): Promise<IngestItem[]> {
  const { data, error } = await ctx.supabase
    .from("job_ingestions")
    .select("id, input_url, status, error_code, job_match_id, updated_at")
    .eq("user_id", ctx.user.id)
    .eq("batch_id", batchId)
    .order("created_at", { ascending: true })
  if (error) throw new Error(`job_ingestions read failed: ${error.message}`)
  // Bruno 24/10: a row left running (function cut off) kept the spinner forever. Anything
  // still running after STALE_MS is shown as a timeout with the paste-text fallback.
  const now = Date.now()
  return (data as (IngestionRow & { updated_at?: string })[]).map((row) =>
    (row.status === "pendente" || row.status === "processando") &&
    row.updated_at &&
    now - new Date(row.updated_at).getTime() > STALE_MS
      ? toItem({ ...row, status: "falhou", error_code: "timeout" })
      : toItem(row)
  )
}

type MatchRow = {
  id: string
  job_posting_id: string
  fit: JobCardData["fit"]
  fit_score: number | null
  reasons: JobCardData["reasons"] | null
  gaps: JobCardData["gaps"] | null
  alerts: JobCardData["alerts"] | null
  recommended_cv_version_id: string | null
  suggested_salary: {
    status?: JobCardData["salary"]["status"]
    rule?: {
      target: number
      min: number | null
      currency: string
      period: string
      regime: string
    }
    jobRange?: { min: number | null; max: number | null } | null
    override?: number | null
  } | null
  duplicate_check: JobCardData["duplicate"]
  blocked: boolean | null
  decision: JobDecision | null
  model_version: string | null
  prompt_version: string | null
  job_postings: {
    id: string
    company: string | null
    title: string
    location: string | null
    work_model: string | null
    regime: string | null
    seniority: string | null
    source: string
    canonical_url: string
    apply_url: string | null
    apply_email: string | null
    description_md: string | null
    requirements_required: string[] | null
    requirements_preferred: string[] | null
  } | null
}

const MATCH_SELECT =
  "id, job_posting_id, fit, fit_score, reasons, gaps, alerts, recommended_cv_version_id, suggested_salary, duplicate_check, blocked, decision, model_version, prompt_version, job_postings(id, company, title, location, work_model, regime, seniority, source, canonical_url, apply_url, apply_email, description_md, requirements_required, requirements_preferred)"

/** Card data for the given matches (RLS: only the user's matches are readable). */
export async function loadJobCards(
  ctx: UserContext,
  matchIds: string[]
): Promise<JobCardData[]> {
  if (matchIds.length === 0) return []
  const [matches, applications] = await Promise.all([
    ctx.supabase
      .from("job_matches")
      .select(MATCH_SELECT)
      .eq("user_id", ctx.user.id)
      .in("id", matchIds),
    ctx.supabase
      .from("applications")
      .select("id, status, job_match_id")
      .eq("user_id", ctx.user.id)
      .in("job_match_id", matchIds),
  ])
  if (matches.error)
    throw new Error(`job_matches read failed: ${matches.error.message}`)
  const rows = matches.data as unknown as MatchRow[]
  const cvIds = [
    ...new Set(
      rows
        .map((row) => row.recommended_cv_version_id)
        .filter((id): id is string => Boolean(id))
    ),
  ]
  const cvs = cvIds.length
    ? await ctx.supabase
        .from("cv_versions")
        .select("id, label, language")
        .eq("user_id", ctx.user.id)
        .in("id", cvIds)
    : { data: [], error: null }
  const cvById = new Map(
    ((cvs.data ?? []) as { id: string; label: string; language: string }[]).map(
      (cv) => [cv.id, cv]
    )
  )
  const appByMatch = new Map(
    (
      (applications.data ?? []) as {
        id: string
        status: string
        job_match_id: string
      }[]
    ).map((app) => [app.job_match_id, app])
  )
  const byId = new Map(rows.map((row) => [row.id, row]))
  return matchIds
    .map((id) => byId.get(id))
    .filter((row): row is MatchRow => Boolean(row?.job_postings))
    .map((row) => {
      const posting = row.job_postings as NonNullable<MatchRow["job_postings"]>
      const salary = row.suggested_salary ?? {}
      const cv = row.recommended_cv_version_id
        ? cvById.get(row.recommended_cv_version_id)
        : undefined
      const application = appByMatch.get(row.id)
      return {
        matchId: row.id,
        postingId: posting.id,
        company: posting.company,
        title: posting.title,
        location: posting.location,
        workModel: posting.work_model,
        regime: posting.regime,
        seniority: posting.seniority,
        source: posting.source,
        canonicalUrl: posting.canonical_url,
        applyUrl: posting.apply_url,
        applyEmail: posting.apply_email,
        description: posting.description_md,
        requirementsRequired: posting.requirements_required ?? [],
        requirementsPreferred: posting.requirements_preferred ?? [],
        fit: row.fit,
        score: row.fit_score,
        reasons: row.reasons ?? [],
        gaps: row.gaps ?? [],
        alerts: row.alerts ?? [],
        blocked: row.blocked === true,
        duplicate: row.duplicate_check,
        cv: cv ? { id: cv.id, label: cv.label, language: cv.language } : null,
        salary: {
          status: salary.status ?? "no_seniority",
          target: salary.rule?.target ?? null,
          min: salary.rule?.min ?? null,
          currency: salary.rule?.currency ?? "BRL",
          period: salary.rule?.period ?? "mensal",
          regime: salary.rule?.regime ?? null,
          jobMin: salary.jobRange?.min ?? null,
          jobMax: salary.jobRange?.max ?? null,
          override: salary.override ?? null,
        },
        decision: row.decision,
        application: application
          ? { id: application.id, status: application.status }
          : null,
        modelVersion: row.model_version,
        promptVersion: row.prompt_version,
      }
    })
}

const DECISION_STATUS: Record<JobDecision, ApplicationStatus> = {
  aplicar: "em_andamento",
  pular: "descartada",
  salvar: "rascunho",
}

export type DecisionResult = {
  applicationId: string
  from: ApplicationStatus | null
  to: ApplicationStatus
  applyUrl: string | null
  company: string
  roleTitle: string
}

/**
 * `record_decision` (10.3): Aplicar → em_andamento, Pular → descartada (with reason, CA7.1),
 * Salvar → rascunho. Creates or moves the application through the 9.4 machine.
 */
export async function recordDecision(
  ctx: UserContext,
  input: {
    matchId: string
    decision: JobDecision
    reason?: string | null
    source: EventSource
  }
): Promise<DecisionResult> {
  const { data, error } = await ctx.supabase
    .from("job_matches")
    .select(
      "id, job_posting_id, recommended_cv_version_id, suggested_salary, job_postings(company, title, source, canonical_url, apply_url)"
    )
    .eq("id", input.matchId)
    .eq("user_id", ctx.user.id)
    .maybeSingle()
  if (error) throw new Error(`job_matches read failed: ${error.message}`)
  const match = data as unknown as {
    id: string
    job_posting_id: string
    recommended_cv_version_id: string | null
    suggested_salary: {
      rule?: { target: number; currency: string; regime: string }
      override?: number | null
    } | null
    job_postings: {
      company: string | null
      title: string
      source: string
      canonical_url: string
      apply_url: string | null
    } | null
  } | null
  if (!match?.job_postings) throw new Error("not_found")
  const posting = match.job_postings
  const to = DECISION_STATUS[input.decision]
  const company = posting.company ?? "—"

  const existing = await ctx.supabase
    .from("applications")
    .select("id, status")
    .eq("user_id", ctx.user.id)
    .eq("job_match_id", match.id)
    .maybeSingle()
  if (existing.error)
    throw new Error(`applications read failed: ${existing.error.message}`)
  const current = existing.data as {
    id: string
    status: ApplicationStatus
  } | null

  let applicationId: string
  let from: ApplicationStatus | null = null
  if (!current) {
    const salary = match.suggested_salary
    const amount = salary?.override ?? salary?.rule?.target ?? null
    const inserted = await ctx.supabase
      .from("applications")
      .insert({
        user_id: ctx.user.id,
        job_match_id: match.id,
        job_posting_id: match.job_posting_id,
        company,
        role_title: posting.title,
        source: posting.source,
        route: input.decision === "aplicar" ? "extensao" : null,
        status: to,
        cv_version_id: match.recommended_cv_version_id,
        salary_informed: amount
          ? {
              amount,
              currency: salary?.rule?.currency ?? "BRL",
              regime: salary?.rule?.regime ?? null,
            }
          : null,
        link: posting.canonical_url,
        notes: input.reason ?? null,
      })
      .select("id")
      .single()
    if (inserted.error || !inserted.data)
      throw new Error(`applications insert failed: ${inserted.error?.message}`)
    applicationId = String((inserted.data as { id: string }).id)
    const event = await ctx.supabase.from("application_events").insert({
      user_id: ctx.user.id,
      application_id: applicationId,
      type: "status_change",
      from_status: null,
      to_status: to,
      source: input.source,
      payload: {
        created: true,
        via: "chat",
        decision: input.decision,
        reason: input.reason ?? null,
      },
    })
    if (event.error) {
      await ctx.supabase.from("applications").delete().eq("id", applicationId)
      throw new Error(
        `application_events insert failed: ${event.error.message}`
      )
    }
  } else {
    applicationId = current.id
    from = current.status
    if (current.status !== to) {
      const check = checkTransition(current.status, to, {
        source: input.source,
        confirmedByUser: true,
      })
      if (!check.ok) throw new Error(`invalid_transition:${check.reason}`)
      const moved = await ctx.supabase.rpc("change_application_status", {
        p_application_id: current.id,
        p_from: current.status,
        p_to: to,
        p_source: input.source,
        p_payload: {
          via: "chat",
          decision: input.decision,
          reason: input.reason ?? null,
          reopen: check.reopen,
        },
      })
      if (moved.error)
        throw new Error(
          `change_application_status failed: ${moved.error.message}`
        )
    }
  }

  await ctx.supabase
    .from("job_matches")
    .update({ decision: input.decision, decision_reason: input.reason ?? null })
    .eq("id", match.id)
    .eq("user_id", ctx.user.id)

  if (input.decision === "aplicar") {
    await createApplicationPackage(ctx, applicationId)
  }

  await audit({
    userId: ctx.user.id,
    actor: input.source === "usuario" ? "usuario" : "agente",
    action: "decision.recorded",
    targetType: "job_match",
    targetId: match.id,
    details: {
      decision: input.decision,
      application_id: applicationId,
      from,
      to,
    },
  })
  if (from !== to) {
    await audit({
      userId: ctx.user.id,
      actor: input.source === "usuario" ? "usuario" : "agente",
      action: "status.changed",
      targetType: "application",
      targetId: applicationId,
      details: { from, to, source: input.source, via: "chat" },
    })
  }
  return {
    applicationId,
    from,
    to,
    applyUrl:
      input.decision === "aplicar"
        ? buildApplyUrl(
            posting.apply_url ?? posting.canonical_url,
            applicationId
          )
        : null,
    company,
    roleTitle: posting.title,
  }
}

/** RF6.4 "analisar mesmo assim": recomputes the match ignoring the blocklist. */
export async function analyzeAnyway(
  ctx: UserContext,
  matchId: string
): Promise<void> {
  const { data } = await ctx.supabase
    .from("job_matches")
    .select("job_posting_id")
    .eq("id", matchId)
    .eq("user_id", ctx.user.id)
    .maybeSingle()
  const postingId = (data as { job_posting_id: string } | null)?.job_posting_id
  if (!postingId) throw new Error("not_found")
  const admin = getAdminClient()
  if (!admin) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured")
  const posting = await admin
    .from("job_postings")
    .select(POSTING_COLUMNS)
    .eq("id", postingId)
    .single()
  if (posting.error || !posting.data) throw new Error("not_found")
  await computeMatch(
    { admin, embedder: createEmbedder() },
    ctx.user.id,
    posting.data as unknown as PostingForMatch,
    {
      force: true,
    }
  )
}
