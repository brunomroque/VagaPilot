import type { SupabaseClient } from "@supabase/supabase-js"
import {
  createEmbedder,
  extractFactsFromCv,
  type Embedder,
  type ExtractFactsResult,
} from "@vagapilot/ai"
import {
  logAudit,
  type AuditActor,
  type AuditSink,
} from "@vagapilot/core/audit"
import { factCanonicalKey, spellingFromSource } from "@vagapilot/core/facts"
import { normalizeCompanyName } from "@vagapilot/core/blocklist"
import { detectTextLanguage } from "@vagapilot/core/job-text"

import { CvFileError, cvFileTypeFromPath } from "./cv-files.js"
import { extractCvTextOrOcr } from "./cv-ocr.js"
import { parseAndStoreCv, type CvParseDeps } from "./cv-parsed.js"

export type CvProcessingDeps = {
  /** service_role client: the job runs without a user session, so every query filters user_id. */
  admin: SupabaseClient
  audit: AuditSink
  embedder?: Embedder
  extractFacts?: (text: string) => Promise<ExtractFactsResult>
  actor?: AuditActor
}

export type CvJobInput = { userId: string; cvVersionId: string }

export type CvTextResult =
  | { status: "ok"; text: string; pages: number | null }
  | { status: "failed"; code: CvFileError["code"] }

export type CvFactsResult = {
  proposed: number
  dropped: number
  skipped: boolean
}

/** Marker stored in `extracted_text` when extraction failed, so the UI can say so. */
export const EXTRACTION_FAILED_TEXT = ""

type CvVersionRow = { id: string; storage_path: string }

async function loadVersion(
  admin: SupabaseClient,
  { userId, cvVersionId }: CvJobInput
): Promise<CvVersionRow> {
  const { data, error } = await admin
    .from("cv_versions")
    .select("id, storage_path")
    .eq("id", cvVersionId)
    .eq("user_id", userId)
    .maybeSingle<CvVersionRow>()
  if (error) throw new Error(`cv_versions read failed: ${error.message}`)
  if (!data) throw new CvFileError("unreadable", "CV version not found")
  if (!data.storage_path.startsWith(`${userId}/`)) {
    throw new Error("CV storage path is outside the user's folder")
  }
  return data
}

/** Step 1 of `cv/uploaded`: download, extract the text and store it in `cv_versions`. */
export async function extractAndStoreCvText(
  deps: CvProcessingDeps,
  input: CvJobInput
): Promise<CvTextResult> {
  const version = await loadVersion(deps.admin, input)
  const download = await deps.admin.storage
    .from("cvs")
    .download(version.storage_path)
  if (download.error || !download.data) {
    throw new Error(`CV download failed: ${download.error?.message}`)
  }
  const bytes = new Uint8Array(await download.data.arrayBuffer())

  let result: CvTextResult
  try {
    const { text, pages } = await extractCvTextOrOcr(
      bytes,
      cvFileTypeFromPath(version.storage_path)
    )
    result = { status: "ok", text, pages }
  } catch (error) {
    if (!(error instanceof CvFileError)) throw error
    result = { status: "failed", code: error.code }
  }

  const { error } = await deps.admin
    .from("cv_versions")
    .update({
      extracted_text:
        result.status === "ok" ? result.text : EXTRACTION_FAILED_TEXT,
      extraction_error: result.status === "failed" ? result.code : null,
      detected_language:
        result.status === "ok" && result.text.trim()
          ? detectTextLanguage(result.text)
          : null,
    })
    .eq("id", input.cvVersionId)
    .eq("user_id", input.userId)
  if (error) throw new Error(`cv_versions update failed: ${error.message}`)
  return result
}

/**
 * Step 2 of `cv/uploaded`: extract grounded facts, embed them and store them as `proposto`.
 * Idempotent per CV version (retries do not duplicate proposals).
 */
export async function proposeFactsFromCv(
  deps: CvProcessingDeps,
  input: CvJobInput,
  text: string
): Promise<CvFactsResult> {
  const existing = await deps.admin
    .from("confirmed_facts")
    .select("id", { count: "exact", head: true })
    .eq("user_id", input.userId)
    .eq("source", "cv_upload")
    .eq("source_ref->>cv_version_id", input.cvVersionId)
  if (existing.error) {
    throw new Error(`confirmed_facts read failed: ${existing.error.message}`)
  }
  if ((existing.count ?? 0) > 0)
    return { proposed: 0, dropped: 0, skipped: true }

  const raw = await (deps.extractFacts ?? extractFactsFromCv)(text)
  // QA 02:42: keep company names as written in the CV ("V.tal", not "Vital").
  const extracted = {
    ...raw,
    experiences: raw.experiences.map((e) => ({
      ...e,
      company: spellingFromSource(e.company, text),
    })),
    facts: raw.facts.map((f) => ({
      ...f,
      experienceHint: f.experienceHint
        ? spellingFromSource(f.experienceHint, text)
        : f.experienceHint,
    })),
  }
  // QA 02:30: "ingles avancado" vs "inglês avançado", Kubernetes 3x. Drop facts that repeat
  // one the user already has (any status, any upload), or another one in this same CV.
  const known = await deps.admin
    .from("confirmed_facts")
    .select("statement")
    .eq("user_id", input.userId)
  const seen = new Set(
    ((known.data ?? []) as { statement: string }[]).map((row) =>
      factCanonicalKey(row.statement)
    )
  )
  const unique = extracted.facts.filter((fact) => {
    const key = factCanonicalKey(fact.statement)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
  const extraction = {
    ...extracted,
    facts: unique,
    droppedFacts:
      extracted.droppedFacts + (extracted.facts.length - unique.length),
  }
  if (extraction.facts.length === 0) {
    return { proposed: 0, dropped: extraction.droppedFacts, skipped: false }
  }

  const experiences = await deps.admin
    .from("experiences")
    .select("id, company")
    .eq("user_id", input.userId)
  if (experiences.error) {
    throw new Error(`experiences read failed: ${experiences.error.message}`)
  }
  const experienceByCompany = new Map(
    (experiences.data as { id: string; company: string }[]).map((row) => [
      normalizeCompanyName(row.company),
      row.id,
    ])
  )
  const hints = new Map(
    extraction.experiences.map((experience) => [experience.company, experience])
  )

  const embedder = deps.embedder ?? createEmbedder()
  const embeddings = await embedder.embedMany(
    extraction.facts.map((fact) => fact.statement)
  )

  const rows = extraction.facts.map((fact, index) => {
    const hint = fact.experienceHint
      ? hints.get(fact.experienceHint)
      : undefined
    const company = hint?.company ?? fact.experienceHint
    return {
      user_id: input.userId,
      experience_id: company
        ? (experienceByCompany.get(normalizeCompanyName(company)) ?? null)
        : null,
      statement: fact.statement,
      kind: fact.kind,
      tags: fact.tags,
      status: "proposto",
      source: "cv_upload",
      source_ref: {
        cv_version_id: input.cvVersionId,
        excerpt: fact.excerpt,
        experience_hint: hint
          ? {
              company: hint.company,
              title: hint.title,
              start_month: hint.startMonth,
              end_month: hint.endMonth,
              is_current: hint.isCurrent,
            }
          : company
            ? { company }
            : null,
        model: extraction.model,
        prompt_version: extraction.promptVersion,
        embedding_model: embedder.model,
      },
      embedding: JSON.stringify(embeddings[index]),
    }
  })

  const inserted = await deps.admin
    .from("confirmed_facts")
    .insert(rows)
    .select("id, kind")
  if (inserted.error) {
    throw new Error(`confirmed_facts insert failed: ${inserted.error.message}`)
  }

  for (const row of inserted.data as { id: string; kind: string }[]) {
    await logAudit(deps.audit, {
      userId: input.userId,
      actor: deps.actor ?? "worker",
      action: "fact.proposed",
      targetType: "confirmed_fact",
      targetId: row.id,
      details: {
        source: "cv_upload",
        kind: row.kind,
        cv_version_id: input.cvVersionId,
        model: extraction.model,
        prompt_version: extraction.promptVersion,
      },
    })
  }

  return {
    proposed: inserted.data.length,
    dropped: extraction.droppedFacts,
    skipped: false,
  }
}

/** Synchronous fallback used when no Inngest server is configured (local dev, e2e). */
export async function processCvUpload(
  deps: CvParseDeps,
  input: CvJobInput
): Promise<{
  text: CvTextResult
  parsed: { items: number; diff: number } | null
  facts: CvFactsResult | null
}> {
  const text = await extractAndStoreCvText(deps, input)
  if (text.status !== "ok") return { text, parsed: null, facts: null }
  // Best-effort: a parse failure must not lose the upload or the fact proposals.
  let parsed: { items: number; diff: number } | null = null
  try {
    parsed = await parseAndStoreCv(deps, input, text.text)
  } catch (error) {
    console.error("processCvUpload: structured parse failed", error)
  }
  return {
    text,
    parsed,
    facts: await proposeFactsFromCv(deps, input, text.text),
  }
}
