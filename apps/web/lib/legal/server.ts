import "server-only"

import { createHash } from "node:crypto"

import {
  CLOUD_APPLY_REQUIRED_DOCS,
  LEGAL_CURRENT_VERSIONS,
  documentsNeedingAcceptance,
  evidenceHash,
  legalPublishable,
  renderLegal,
  verifyEvidenceChain,
  type EvidencePayload,
  type EvidenceRecord,
  type LatestAcceptance,
  type LegalSlug,
} from "@vagapilot/core/legal"
import type { SiteRiskLevel } from "@vagapilot/core/risks"
import type { SupabaseClient } from "@supabase/supabase-js"
import { headers } from "next/headers"

import { getAdminClient } from "@/lib/server/admin"

import {
  consentMeta,
  legalDraftAllowed,
  toChainRecord,
  type ConsentQuestionMeta,
  latestByDocument,
  type EvidenceRow,
} from "./pure"

export { consentMeta, legalDraftAllowed, toChainRecord }
export type { ConsentQuestionMeta, EvidenceRow }

export type LegalDocumentView = {
  id: string
  slug: LegalSlug
  version: string
  title: string
  effectiveDate: string
  text: string
  sha256: string
  missingTags: string[]
  publishable: boolean
}

export function uiVersion(env = process.env): string {
  return (env.COMMIT_REF ?? env.NEXT_PUBLIC_APP_VERSION ?? "dev").slice(0, 40)
}

type DocRow = {
  id: string
  slug: LegalSlug
  version: string
  title: string
  effective_date: string
  body_md: string
}

function toView(row: DocRow): LegalDocumentView {
  const rendered = renderLegal(row.body_md, {
    version: row.version,
    effectiveDate: row.effective_date,
  })
  return {
    id: row.id,
    slug: row.slug,
    version: row.version,
    title: row.title,
    effectiveDate: row.effective_date,
    text: rendered.text,
    sha256: rendered.sha256,
    missingTags: rendered.missing,
    publishable: legalPublishable(rendered, legalDraftAllowed()),
  }
}

/** Current version of each document, rendered with LEGAL_VARS (hash over the rendered text). */
export async function loadCurrentLegalDocuments(
  admin: SupabaseClient | null = getAdminClient()
): Promise<Partial<Record<LegalSlug, LegalDocumentView>>> {
  if (!admin) return {}
  const { data } = await admin
    .from("legal_documents")
    .select("id, slug, version, title, effective_date, body_md")
    .in("slug", Object.keys(LEGAL_CURRENT_VERSIONS))
  const out: Partial<Record<LegalSlug, LegalDocumentView>> = {}
  for (const row of (data ?? []) as DocRow[]) {
    if (LEGAL_CURRENT_VERSIONS[row.slug] === row.version) out[row.slug] = toView(row)
  }
  return out
}

export async function loadLegalDocumentById(id: string): Promise<LegalDocumentView | null> {
  const admin = getAdminClient()
  if (!admin) return null
  const { data } = await admin
    .from("legal_documents")
    .select("id, slug, version, title, effective_date, body_md")
    .eq("id", id)
    .maybeSingle()
  return data ? toView(data as DocRow) : null
}

const EVIDENCE_COLUMNS =
  "id, seq, user_id, email, action, document_id, document_slug, document_version, document_sha256, checkboxes, typed_confirmation, accepted_at, recorded_at, ip, user_agent, session_id, locale, ui_version, prev_hash, record_hash"


export async function loadEvidence(userId: string): Promise<EvidenceRow[]> {
  const admin = getAdminClient()
  if (!admin) return []
  const { data } = await admin
    .from("legal_acceptances")
    .select(EVIDENCE_COLUMNS)
    .eq("user_id", userId)
    .order("seq", { ascending: true })
  return ((data ?? []) as EvidenceRow[]).map((r) => ({
    ...r,
    accepted_at: new Date(r.accepted_at).toISOString(),
  }))
}

export { latestByDocument }

export type CloudApplyConsent = {
  ok: boolean
  pending: LegalSlug[]
  revoked: boolean
}

/** Gate of the cloud apply: every required document accepted at its current version/hash. */
export async function cloudApplyConsent(userId: string): Promise<CloudApplyConsent> {
  const [docs, rows] = await Promise.all([loadCurrentLegalDocuments(), loadEvidence(userId)])
  const latest = latestByDocument(rows)
  const current = Object.fromEntries(
    Object.entries(docs).map(([slug, d]) => [slug, { version: d!.version, sha256: d!.sha256 }])
  )
  const pending = documentsNeedingAcceptance(latest, current, CLOUD_APPLY_REQUIRED_DOCS)
  const revoked = CLOUD_APPLY_REQUIRED_DOCS.some((s) => latest[s]?.action === "revoke")
  return { ok: pending.length === 0, pending, revoked }
}

export async function requestMeta(): Promise<{
  ip: string | null
  userAgent: string | null
  locale: string | null
}> {
  const h = await headers()
  const ip =
    h.get("x-nf-client-connection-ip") ??
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    h.get("x-real-ip") ??
    null
  return {
    ip,
    userAgent: h.get("user-agent")?.slice(0, 500) ?? null,
    locale: h.get("accept-language")?.split(",")[0]?.trim().slice(0, 20) ?? null,
  }
}

/** Session id from the access token claims (never the token itself). */
export function sessionIdFromClaims(claims: Record<string, unknown> | null | undefined): string | null {
  const sid = claims?.session_id
  return typeof sid === "string" ? sid : null
}

/**
 * Appends one evidence record, chained to the user's previous record. The DB rejects forks
 * (unique user_id+prev_hash) and any UPDATE/DELETE (trigger), so a race just retries.
 */
export async function appendEvidence(
  input: Omit<EvidencePayload, "accepted_at" | "ui_version"> & { document_id: string }
): Promise<EvidenceRow | null> {
  const admin = getAdminClient()
  if (!admin) return null
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: last } = await admin
      .from("legal_acceptances")
      .select("record_hash")
      .eq("user_id", input.user_id)
      .order("seq", { ascending: false })
      .limit(1)
      .maybeSingle()
    const prev = (last as { record_hash: string } | null)?.record_hash ?? null
    const { document_id, ...rest } = input
    const payload: EvidencePayload = {
      ...rest,
      accepted_at: new Date().toISOString(),
      ui_version: uiVersion(),
    }
    const record_hash = evidenceHash(prev, payload)
    const { data, error } = await admin
      .from("legal_acceptances")
      .insert({ ...payload, document_id, prev_hash: prev, record_hash })
      .select(EVIDENCE_COLUMNS)
      .single()
    if (!error && data) return data as EvidenceRow
    if (error?.code !== "23505") return null
  }
  return null
}

export type AcceptanceCertificate = {
  kind: "vagapilot.legal_acceptance_certificate"
  generated_at: string
  disclaimer: string
  record: EvidenceRow
  document: { id: string; slug: string; version: string; title: string; sha256: string; text: string } | null
  document_hash_matches: boolean
  chain: { length: number; verified: boolean; broken_at: number | null }
  certificate_sha256: string
}

/** JSON certificate of one record: rendered text, evidence and chain verification. */
export async function buildCertificate(
  recordId: string,
  userId: string
): Promise<AcceptanceCertificate | null> {
  const rows = await loadEvidence(userId)
  const record = rows.find((r) => r.id === recordId)
  if (!record) return null
  const doc = await loadLegalDocumentById(record.document_id)
  const chainRecords: EvidenceRecord[] = rows.map(toChainRecord)
  const broken = verifyEvidenceChain(chainRecords)
  const body = {
    kind: "vagapilot.legal_acceptance_certificate" as const,
    generated_at: new Date().toISOString(),
    disclaimer:
      "Registro técnico do aceite eletrônico. Não constitui atestado de validade jurídica.",
    record,
    document: doc
      ? { id: doc.id, slug: doc.slug, version: doc.version, title: doc.title, sha256: doc.sha256, text: doc.text }
      : null,
    document_hash_matches: doc?.sha256 === record.document_sha256,
    chain: { length: rows.length, verified: broken === -1, broken_at: broken === -1 ? null : broken },
  }
  return {
    ...body,
    certificate_sha256: createHash("sha256").update(JSON.stringify(body)).digest("hex"),
  }
}

/** Append-only record of the per-action ATS consent decision (Aceito / Cancelar). */
export async function recordConsentDecision(input: {
  userId: string
  applicationId: string | null
  questionId: string
  fieldLabel: string
  meta: ConsentQuestionMeta
  decision: "aceito" | "cancelado"
}): Promise<void> {
  const admin = getAdminClient()
  if (!admin) return
  const req = await requestMeta()
  await admin.from("apply_consent_decisions").insert({
    user_id: input.userId,
    application_id: input.applicationId,
    question_id: input.questionId,
    site: input.meta.site ?? "desconhecido",
    field_label: input.fieldLabel.slice(0, 500),
    terms_url: input.meta.terms_url ?? null,
    terms_sha256: input.meta.terms_sha256 ?? null,
    decision: input.decision,
    ip: req.ip,
    user_agent: req.userAgent,
  })
}

/** Admin-editable per-domain risk levels. */
export async function loadSiteRiskLevels(): Promise<{ domain: string; level: SiteRiskLevel; note: string | null }[]> {
  const admin = getAdminClient()
  if (!admin) return []
  const { data } = await admin.from("site_risk_levels").select("domain, level, note").order("domain")
  return (data ?? []) as { domain: string; level: SiteRiskLevel; note: string | null }[]
}

/** Admin: number of distinct users whose latest record for (slug, version) is an acceptance. */
export async function countCurrentAcceptances(slug: LegalSlug, version: string): Promise<number> {
  const admin = getAdminClient()
  if (!admin) return 0
  const { data } = await admin
    .from("legal_acceptances")
    .select("user_id, action, document_version, seq")
    .eq("document_slug", slug)
    .order("seq", { ascending: true })
    .limit(10_000)
  const latest = new Map<string, { action: string; document_version: string }>()
  for (const r of (data ?? []) as { user_id: string; action: string; document_version: string }[])
    latest.set(r.user_id, r)
  return [...latest.values()].filter((r) => r.action === "accept" && r.document_version === version).length
}
