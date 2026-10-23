import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

import { beforeEach, describe, expect, it, vi } from "vitest"

import { categoryCounts, type SensitiveReport } from "@vagapilot/core/sensitive-report"

// In-memory Supabase stand-in: records every write per table.
const writes: { table: string; op: string; row: Record<string, unknown> }[] = []
let modeRow: { mode: string } | null = null

function table(name: string) {
  const q: Record<string, unknown> = {}
  const chain = () => q
  Object.assign(q, {
    select: chain,
    eq: chain,
    order: chain,
    limit: chain,
    delete: chain,
    update: (row: Record<string, unknown>) => {
      writes.push({ table: name, op: "update", row })
      return q
    },
    upsert: (row: Record<string, unknown>) => {
      writes.push({ table: name, op: "upsert", row })
      return q
    },
    single: async () => ({ data: { id: "rule-1" }, error: null }),
    maybeSingle: async () => ({ data: name === "agent_permissions" ? modeRow : null, error: null }),
    then: (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
  })
  return q
}

vi.mock("@/lib/server/admin", () => ({ getAdminClient: () => ({ from: table }) }))
const evidence: Record<string, unknown>[] = []
vi.mock("@/lib/legal/server", () => ({
  appendEvidence: async (input: Record<string, unknown>) => {
    evidence.push(input)
    return { record_hash: "h".repeat(64) }
  },
  cloudApplyConsent: async () => ({ ok: true, pending: [], revoked: false }),
  loadCurrentLegalDocuments: async () => ({
    "termo-riscos-automacao": { id: "doc", slug: "termo-riscos-automacao", version: "v", sha256: "s".repeat(64) },
  }),
  requestMeta: async () => ({ ip: null, userAgent: null, locale: "pt-BR" }),
}))

const { applyCardChoice } = await import("./server")
const actor = { id: "u1", email: "u@example.com", sessionId: null }
const meta = { action: "accept_site_terms", host: "acme.gupy.io", categories: ["termos"], missing: [] }

beforeEach(() => {
  writes.length = 0
  evidence.length = 0
  modeRow = { mode: "ask" }
})

describe("run card persistence", () => {
  it("one-time choices persist nothing", async () => {
    expect(await applyCardChoice(actor, meta, "once", null)).toEqual({ ok: true, data: { allow: true, ruleId: null } })
    expect(await applyCardChoice(actor, meta, "deny", null)).toEqual({ ok: true, data: { allow: false, ruleId: null } })
    expect(writes).toEqual([])
    expect(evidence).toEqual([])
  })

  it("'Sempre permitir neste site' needs the category grant and the mandate acknowledgement", async () => {
    const r = await applyCardChoice(actor, meta, "always", null)
    expect(r.ok).toBe(false)
    expect(writes).toEqual([])
  })

  it("'Sempre permitir neste site' saves an allow rule, logs evidence and switches ask → allowlist", async () => {
    const r = await applyCardChoice(actor, meta, "always", { categories: ["termos"], acknowledged: true })
    expect(r).toEqual({ ok: true, data: { allow: true, ruleId: "rule-1" } })
    const rule = writes.find((w) => w.table === "agent_permission_rules")!
    expect(rule.row).toMatchObject({
      domain_pattern: "acme.gupy.io",
      effect: "allow",
      categories: ["termos"],
      source: "run_card",
    })
    expect(evidence[0]).toMatchObject({ action: "permission_grant" })
    expect(writes.find((w) => w.table === "agent_permissions")?.row).toMatchObject({ mode: "allowlist" })
  })

  it("sensitive categories require the typed confirmation", async () => {
    const bad = await applyCardChoice(actor, meta, "always", { categories: ["saude"], acknowledged: true })
    expect(bad.ok).toBe(false)
    const good = await applyCardChoice(actor, meta, "always", {
      categories: ["saude"],
      acknowledged: true,
      sensitiveConfirmation: "AUTORIZO DADOS SENSIVEIS",
    })
    expect(good.ok).toBe(true)
  })

  it("'Negar sempre neste site' saves a deny rule without a grant", async () => {
    const r = await applyCardChoice(actor, meta, "denyAlways", null)
    expect(r).toEqual({ ok: true, data: { allow: false, ruleId: "rule-1" } })
    expect(writes.find((w) => w.table === "agent_permission_rules")?.row).toMatchObject({ effect: "deny", categories: [] })
    expect(evidence).toEqual([])
  })

  it("final submit can never be made permanent from the run card", async () => {
    const r = await applyCardChoice(actor, { ...meta, action: "final_submit" }, "always", {
      categories: ["contato"],
      acknowledged: true,
    })
    expect(r.ok).toBe(false)
  })
})

describe("admin views never expose sensitive values", () => {
  it("admin-safe counts carry only category totals", () => {
    const report: SensitiveReport = {
      site: "acme.gupy.io",
      generatedAt: "2026-10-23T12:00:00Z",
      entries: [
        { question: "Você é PcD?", answer: "Sim, CID X", category: "saude", categoryLabel: "Saúde", sensitive: true, origin: "regra", confidence: 0.9 },
      ],
    }
    const json = JSON.stringify(categoryCounts(report))
    expect(json).toBe(JSON.stringify({ saude: 1 }))
    expect(json).not.toContain("CID")
  })

  it("no admin code reads the sealed report column", () => {
    const root = join(__dirname, "..", "..")
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name.startsWith(".")) continue
        const p = join(dir, name)
        if (statSync(p).isDirectory()) walk(p)
        else if (/admin/i.test(p) && /\.(ts|tsx)$/.test(p) && readFileSync(p, "utf8").includes("sensitive_report_enc"))
          offenders.push(p)
      }
    }
    walk(join(root, "app"))
    walk(join(root, "lib"))
    expect(offenders).toEqual([])
  })
})
