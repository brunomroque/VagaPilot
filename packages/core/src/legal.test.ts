import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  LEGAL_TAGS, allClausesChecked, canonicalJson, documentsNeedingAcceptance, evidenceHash,
  legalPublishable, renderLegal, sessionIsFresh, typedConfirmationOk, verifyEvidenceChain,
  type EvidencePayload, type EvidenceRecord,
} from "./legal.js"

const base: Omit<EvidencePayload, "action" | "accepted_at"> = {
  user_id: "u1", email: "a@b.com", document_slug: "termo-riscos-automacao", document_version: "v1",
  document_sha256: "h1", checkboxes: { erros_ia: true }, typed_confirmation: "ACEITO",
  ip: "1.1.1.1", user_agent: "ua", session_id: "s", locale: "pt-BR", ui_version: "abc",
}

function chain(actions: ("accept" | "revoke")[]): EvidenceRecord[] {
  const out: EvidenceRecord[] = []
  let prev: string | null = null
  actions.forEach((action, i) => {
    const payload = { ...base, action, accepted_at: `2026-10-23T00:00:0${i}Z` }
    const record_hash = evidenceHash(prev, payload)
    out.push({ ...payload, prev_hash: prev, record_hash })
    prev = record_hash
  })
  return out
}

describe("legal rendering", () => {
  it("renders tags and reports missing ones; hash is over rendered text", () => {
    const r = renderLegal("{{RAZAO_SOCIAL}} v{{VERSAO}} {{SITE_URL}}", { version: "1", effectiveDate: "x" }, { RAZAO_SOCIAL: "", SITE_URL: "https://s" })
    expect(r.text).toBe("{{RAZAO_SOCIAL}} v1 https://s")
    expect(r.missing).toEqual(["RAZAO_SOCIAL"])
    expect(legalPublishable(r, false)).toBe(false)
    expect(legalPublishable(r, true)).toBe(true)
    const a = renderLegal("{{X}}", { version: "1", effectiveDate: "x" }, { X: "A" })
    const b = renderLegal("{{X}}", { version: "1", effectiveDate: "x" }, { X: "B" })
    expect(a.sha256).not.toBe(b.sha256)
    expect(a.missing).toEqual([])
  })

  it("docs only use documented tags and the risk term is a MINUTA", () => {
    const dir = new URL("../../../docs/legal/", import.meta.url)
    const tagsDoc = readFileSync(new URL("TAGS.md", dir), "utf8")
    for (const f of ["termos-de-uso.md", "politica-de-privacidade.md", "termo-riscos-automacao.md"]) {
      const text = readFileSync(new URL(f, dir), "utf8")
      expect(text).toContain("MINUTA – revisar com advogado")
      for (const m of text.matchAll(/\{\{([A-Z0-9_]+)\}\}/g)) {
        expect(LEGAL_TAGS).toContain(m[1])
        expect(tagsDoc).toContain(`{{${m[1]}}}`)
      }
    }
  })
})

describe("acceptance evidence", () => {
  it("canonical JSON is key-order independent", () => {
    expect(canonicalJson({ b: 1, a: [1, { d: 2, c: 3 }] })).toBe(canonicalJson({ a: [1, { c: 3, d: 2 }], b: 1 }))
  })

  it("verifies a hash chain and detects tampering", () => {
    const c = chain(["accept", "revoke", "accept"])
    expect(verifyEvidenceChain(c)).toBe(-1)
    const tampered = c.map((r) => ({ ...r }))
    tampered[1]!.ip = "6.6.6.6"
    expect(verifyEvidenceChain(tampered)).toBe(1)
    expect(verifyEvidenceChain([c[0]!, c[2]!])).toBe(1)
  })

  it("re-prompts on new version or text and after revocation", () => {
    const cur = { "termo-riscos-automacao": { version: "v1", sha256: "h1" } }
    const req = ["termo-riscos-automacao"] as const
    expect(documentsNeedingAcceptance({}, cur, req)).toEqual(["termo-riscos-automacao"])
    expect(documentsNeedingAcceptance({ "termo-riscos-automacao": { action: "accept", document_version: "v1", document_sha256: "h1" } }, cur, req)).toEqual([])
    expect(documentsNeedingAcceptance({ "termo-riscos-automacao": { action: "accept", document_version: "v0", document_sha256: "h1" } }, cur, req)).toHaveLength(1)
    expect(documentsNeedingAcceptance({ "termo-riscos-automacao": { action: "accept", document_version: "v1", document_sha256: "h2" } }, cur, req)).toHaveLength(1)
    expect(documentsNeedingAcceptance({ "termo-riscos-automacao": { action: "revoke", document_version: "v1", document_sha256: "h1" } }, cur, req)).toHaveLength(1)
  })

  it("requires every clause, a fresh session and a valid typed confirmation", () => {
    expect(allClausesChecked("politica-de-privacidade", { ciente_privacidade: true })).toBe(false)
    expect(allClausesChecked("politica-de-privacidade", { ciente_privacidade: true, transferencia_internacional: true })).toBe(true)
    expect(allClausesChecked("politica-de-privacidade", { ciente_privacidade: "true", transferencia_internacional: true })).toBe(false)
    const now = Date.parse("2026-10-23T12:00:00Z")
    expect(sessionIsFresh("2026-10-23T11:57:00Z", now)).toBe(true)
    expect(sessionIsFresh("2026-10-23T11:50:00Z", now)).toBe(false)
    expect(sessionIsFresh(null, now)).toBe(false)
    expect(typedConfirmationOk("aceito", null)).toBe(true)
    expect(typedConfirmationOk("Bruno Roque", "bruno roque")).toBe(true)
    expect(typedConfirmationOk("x", "Bruno")).toBe(false)
    expect(typedConfirmationOk("", null)).toBe(true)
  })
})
