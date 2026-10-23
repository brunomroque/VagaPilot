import { describe, expect, it } from "vitest"

import {
  CLOUD_APPLY_REQUIRED_DOCS,
  documentsNeedingAcceptance,
  evidenceHash,
  verifyEvidenceChain,
  type EvidencePayload,
} from "@vagapilot/core/legal"

import { consentMeta, latestByDocument, legalDraftAllowed, toChainRecord, type EvidenceRow } from "./pure"

function row<A extends EvidenceRow["action"]>(prev: string | null, seq: number, action: A): EvidenceRow & { action: A } {
  const payload: EvidencePayload = {
    user_id: "u1",
    email: "u@example.com",
    action,
    document_slug: "termo-riscos-automacao",
    document_version: "2026-10-23.1",
    document_sha256: "a".repeat(64),
    checkboxes: { b: true, a: true },
    typed_confirmation: null,
    accepted_at: new Date(Date.UTC(2026, 9, 23, 12, seq)).toISOString(),
    ip: "203.0.113.1",
    user_agent: "ua",
    session_id: "s",
    locale: "pt-BR",
    ui_version: "dev",
  }
  return {
    ...payload,
    prev_hash: prev,
    record_hash: evidenceHash(prev, payload),
    id: `id-${seq}`,
    seq,
    document_id: "d",
    recorded_at: payload.accepted_at,
  } as EvidenceRow & { action: A }
}

describe("legal evidence (web layer)", () => {
  it("DB rows (with extra columns) verify as a chain; tampering is detected", () => {
    const a = row(null, 1, "accept")
    const b = row(a.record_hash, 2, "revoke")
    expect(verifyEvidenceChain([a, b].map(toChainRecord))).toBe(-1)
    const tampered = { ...b, ip: "198.51.100.9" }
    expect(verifyEvidenceChain([a, tampered].map(toChainRecord))).toBe(1)
  })

  it("revocation as latest record blocks the cloud-apply gate", () => {
    const a = row(null, 1, "accept")
    const b = row(a.record_hash, 2, "revoke")
    const current = { "termo-riscos-automacao": { version: a.document_version, sha256: a.document_sha256 } }
    expect(documentsNeedingAcceptance({ "termo-riscos-automacao": a }, current, ["termo-riscos-automacao"])).toEqual([])
    expect(documentsNeedingAcceptance({ "termo-riscos-automacao": b }, current, ["termo-riscos-automacao"])).toEqual([
      "termo-riscos-automacao",
    ])
    expect(CLOUD_APPLY_REQUIRED_DOCS).toContain("termo-riscos-automacao")
  })

  it("permission grant/revoke records never change the acceptance gate", () => {
    const a = row(null, 1, "accept")
    const g = row(a.record_hash, 2, "permission_grant")
    const r = row(g.record_hash, 3, "permission_revoke")
    const latest = latestByDocument([a, g, r])
    expect(latest["termo-riscos-automacao"]?.action).toBe("accept")
    expect(latest["termo-riscos-automacao"]?.seq).toBe(1)
  })

  it("consentMeta only recognizes consent questions", () => {
    expect(consentMeta({ consent: true, run_id: "r" })?.run_id).toBe("r")
    expect(consentMeta({ consent: "yes" })).toBeNull()
    expect(consentMeta(null)).toBeNull()
  })

  it("draft texts are allowed outside production or with LEGAL_ALLOW_DRAFT", () => {
    expect(legalDraftAllowed({ NODE_ENV: "production" })).toBe(false)
    expect(legalDraftAllowed({ NODE_ENV: "production", LEGAL_ALLOW_DRAFT: "true" })).toBe(true)
    expect(legalDraftAllowed({ NODE_ENV: "development" })).toBe(true)
  })
})
