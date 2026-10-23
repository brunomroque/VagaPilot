import type { EvidenceRecord, LatestAcceptance, LegalSlug } from "@vagapilot/core/legal"

/** Pure helpers of the legal-evidence layer (unit-tested without Next/Supabase). */

export type EvidenceRow = EvidenceRecord & {
  id: string
  seq: number
  document_id: string
  recorded_at: string
}

export function legalDraftAllowed(env = process.env): boolean {
  return env.LEGAL_ALLOW_DRAFT === "true" || env.NODE_ENV !== "production"
}

export function toChainRecord(r: EvidenceRow): EvidenceRecord {
  return {
    user_id: r.user_id,
    email: r.email,
    action: r.action,
    document_slug: r.document_slug,
    document_version: r.document_version,
    document_sha256: r.document_sha256,
    checkboxes: r.checkboxes,
    typed_confirmation: r.typed_confirmation,
    accepted_at: r.accepted_at,
    ip: r.ip,
    user_agent: r.user_agent,
    session_id: r.session_id,
    locale: r.locale,
    ui_version: r.ui_version,
    prev_hash: r.prev_hash,
    record_hash: r.record_hash,
  }
}

export type ConsentQuestionMeta = {
  consent: true
  run_id?: string
  site?: string
  terms_url?: string | null
  terms_sha256?: string | null
}

export function consentMeta(proposedFrom: unknown): ConsentQuestionMeta | null {
  const p = proposedFrom as Partial<ConsentQuestionMeta> | null
  return p && p.consent === true ? (p as ConsentQuestionMeta) : null
}


/**
 * Latest acceptance/revocation per document. Standing-permission records
 * (permission_grant/permission_revoke) share the hash chain but never change the gate.
 */
export function latestByDocument(
  rows: readonly EvidenceRow[]
): Partial<Record<LegalSlug, EvidenceRow & LatestAcceptance>> {
  const out: Partial<Record<LegalSlug, EvidenceRow & LatestAcceptance>> = {}
  for (const r of rows) {
    if (r.action !== "accept" && r.action !== "revoke") continue
    out[r.document_slug as LegalSlug] = { ...r, action: r.action }
  }
  return out
}
