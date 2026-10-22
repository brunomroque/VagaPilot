import { createHash } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"
import {
  canonicalizeUrl,
  detectSource,
  extractJob,
  type FetchCtx,
  type RawJobPosting,
} from "@vagapilot/ats-adapters"
import {
  createEmbedder,
  extractJobPosting,
  type Embedder,
  type ExtractJobResult,
} from "@vagapilot/ai"
import {
  logAudit,
  type AuditActor,
  type AuditSink,
} from "@vagapilot/core/audit"
import { normalizeCompanyName } from "@vagapilot/core/blocklist"
import { findApplyEmail } from "@vagapilot/core/job-text"

import {
  computeMatch,
  POSTING_COLUMNS,
  type MatchDeps,
  type PostingForMatch,
} from "./match.js"

/** P6.3: entitlements before/after a full job analysis (extract + fit). */
export type JobAnalysisUsage = {
  beforeExtract(userId: string): Promise<void>
  beforeAssess(userId: string): Promise<void>
  afterComplete(userId: string): Promise<void>
}

export type IngestDeps = {
  /** service_role: job_postings is global and written only by the server (9). */
  admin: SupabaseClient
  audit: AuditSink
  fetchCtx: FetchCtx
  embedder?: Embedder
  extract?: (raw: RawJobPosting) => Promise<ExtractJobResult>
  assess?: MatchDeps["assess"]
  usage?: JobAnalysisUsage
  searchGmailDuplicates?: MatchDeps["searchGmailDuplicates"]
  actor?: AuditActor
  now?: () => Date
}

export type IngestionStatus =
  "pendente" | "processando" | "concluida" | "falhou" | "bloqueada"

export type IngestionOutcome = {
  ingestionId: string
  status: IngestionStatus
  errorCode: string | null
  jobPostingId: string | null
  jobMatchId: string | null
}

type IngestionRow = {
  id: string
  user_id: string
  status: IngestionStatus
  input_url: string | null
  input_text: string | null
  job_posting_id: string | null
  job_match_id: string | null
}

export const MAX_PASTED_TEXT = 20_000

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

/** Pasted description (CA4.2 fallback or text/e-mail pasted in the chat, RF4.1). */
export function rawFromText(text: string, url: string | null): RawJobPosting {
  const description = text.slice(0, MAX_PASTED_TEXT).trim()
  const firstLine =
    description
      .split(/\r?\n/)
      .find((line) => line.trim().length > 0)
      ?.trim() ?? "Vaga colada"
  const canonical = url ? canonicalizeUrl(url) : null
  return {
    source: url ? detectSource(url) : "outro",
    canonicalUrl:
      canonical ?? `vagapilot:texto/${sha256(description).slice(0, 40)}`,
    externalId: null,
    title: firstLine.slice(0, 200),
    company: null,
    companyDomain: null,
    location: null,
    workModelHint: null,
    employmentTypeHint: null,
    descriptionText: description,
    requirementsHint: null,
    salary: null,
    postedAt: null,
    applyUrl: url,
    applyEmail: findApplyEmail(description),
    externalApply: null,
  }
}

async function update(
  admin: SupabaseClient,
  row: IngestionRow,
  values: Record<string, unknown>
): Promise<void> {
  const { error } = await admin
    .from("job_ingestions")
    .update(values)
    .eq("id", row.id)
    .eq("user_id", row.user_id)
  if (error) throw new Error(`job_ingestions update failed: ${error.message}`)
}

function outcome(
  row: IngestionRow,
  values: Partial<IngestionOutcome>
): IngestionOutcome {
  return {
    ingestionId: row.id,
    status: values.status ?? row.status,
    errorCode: values.errorCode ?? null,
    jobPostingId: values.jobPostingId ?? row.job_posting_id,
    jobMatchId: values.jobMatchId ?? row.job_match_id,
  }
}

/** Upsert by canonical URL (RF4.5): public posting data shared between users. */
export async function upsertPosting(
  deps: Pick<IngestDeps, "admin" | "embedder">,
  raw: RawJobPosting,
  extracted: ExtractJobResult
): Promise<PostingForMatch> {
  const job = extracted.job
  const embedder = deps.embedder ?? createEmbedder()
  const embedding = await embedder.embed(
    [
      job.title,
      job.company ?? "",
      ...job.requirementsRequired,
      ...job.requirementsPreferred,
    ].join("\n")
  )
  const { data, error } = await deps.admin
    .from("job_postings")
    .upsert(
      {
        canonical_url: raw.canonicalUrl,
        source: raw.source,
        external_id: job.jobCode ?? raw.externalId,
        company: job.company,
        company_normalized: job.company
          ? normalizeCompanyName(job.company)
          : null,
        company_domain: raw.companyDomain,
        title: job.title,
        seniority: job.seniority,
        location: job.location,
        work_model: job.workModel,
        regime: job.regime,
        language: job.language,
        requirements_required: job.requirementsRequired,
        requirements_preferred: job.requirementsPreferred,
        languages_required: job.languagesRequired,
        salary_min: job.salary?.min ?? null,
        salary_max: job.salary?.max ?? null,
        salary_currency: job.salary?.currency ?? null,
        apply_url: job.applyUrl,
        apply_email: job.applyEmail,
        description_md: raw.descriptionText.slice(0, MAX_PASTED_TEXT),
        raw_hash: sha256(raw.descriptionText),
        posted_at: job.postedAt,
        fetched_at: new Date().toISOString(),
        embedding: JSON.stringify(embedding),
      },
      { onConflict: "canonical_url" }
    )
    .select(POSTING_COLUMNS)
    .single()
  if (error || !data)
    throw new Error(`job_postings upsert failed: ${error?.message}`)
  return data as unknown as PostingForMatch
}

/**
 * `job/ingest.requested` for one link (8.4, P2.2): adapter → extractJobPosting (untrusted) →
 * upsert job_postings → embedding → job_matches. Failures end as `falhou`/`bloqueada` with a
 * code, so the chat can ask for the pasted text (CA4.2). Idempotent per ingestion row.
 */
export async function processJobIngestion(
  deps: IngestDeps,
  input: { userId: string; ingestionId: string }
): Promise<IngestionOutcome> {
  const { data, error } = await deps.admin
    .from("job_ingestions")
    .select(
      "id, user_id, status, input_url, input_text, job_posting_id, job_match_id"
    )
    .eq("id", input.ingestionId)
    .eq("user_id", input.userId)
    .maybeSingle()
  if (error) throw new Error(`job_ingestions read failed: ${error.message}`)
  const row = data as IngestionRow | null
  if (!row) throw new Error("Ingestion not found for this user")
  if (row.status === "concluida") return outcome(row, {})

  await update(deps.admin, row, { status: "processando", error_code: null })

  try {
    let raw: RawJobPosting
    if (row.input_text) {
      raw = rawFromText(row.input_text, row.input_url)
    } else if (row.input_url) {
      const extracted = await extractJob(row.input_url, deps.fetchCtx)
      if (extracted.status !== "ok") {
        const status: IngestionStatus =
          extracted.status === "blocked" ? "bloqueada" : "falhou"
        const errorCode =
          extracted.status === "blocked" ? extracted.reason : extracted.code
        await update(deps.admin, row, {
          status,
          error_code: errorCode,
          canonical_url: canonicalizeUrl(row.input_url),
          source: detectSource(row.input_url),
        })
        return outcome(row, { status, errorCode })
      }
      raw = extracted.posting
    } else {
      await update(deps.admin, row, { status: "falhou", error_code: "empty" })
      return outcome(row, { status: "falhou", errorCode: "empty" })
    }

    const extracted = await (deps.extract ?? extractJobPosting)(raw, {
      assertBillable: () =>
        deps.usage?.beforeExtract(input.userId) ?? Promise.resolve(),
    })
    const posting = await upsertPosting(deps, raw, extracted)
    const embedder = deps.embedder ?? createEmbedder()
    const match = await computeMatch(
      {
        admin: deps.admin,
        embedder,
        assess: deps.assess,
        assessBillable: () =>
          deps.usage?.beforeAssess(input.userId) ?? Promise.resolve(),
        now: deps.now,
        searchGmailDuplicates: deps.searchGmailDuplicates,
      },
      input.userId,
      posting,
      {
        extractModel: extracted.model,
        extractPromptVersion: extracted.promptVersion,
      }
    )

    await (deps.usage?.afterComplete(input.userId) ?? Promise.resolve())

    await update(deps.admin, row, {
      status: "concluida",
      error_code: null,
      canonical_url: raw.canonicalUrl,
      source: raw.source,
      job_posting_id: posting.id,
      job_match_id: match.matchId,
    })

    const actor = deps.actor ?? "worker"
    await logAudit(deps.audit, {
      userId: input.userId,
      actor,
      action: "job.ingested",
      targetType: "job_posting",
      targetId: posting.id,
      details: {
        source: raw.source,
        model: extracted.model,
        prompt_version: extracted.promptVersion,
      },
    })
    if (extracted.injectionDetected) {
      await logAudit(deps.audit, {
        userId: input.userId,
        actor,
        action: "chat.injection_blocked",
        targetType: "job_posting",
        targetId: posting.id,
        details: { origin: "job_posting" },
      })
    }
    await logAudit(deps.audit, {
      userId: input.userId,
      actor,
      action: "match.created",
      targetType: "job_match",
      targetId: match.matchId,
      details: { blocked: match.blocked, fit: match.fit },
    })
    return outcome(row, {
      status: "concluida",
      jobPostingId: posting.id,
      jobMatchId: match.matchId,
    })
  } catch (failure) {
    await update(deps.admin, row, { status: "falhou", error_code: "internal" })
    throw failure
  }
}
