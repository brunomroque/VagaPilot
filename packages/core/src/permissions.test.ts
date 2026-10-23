import { describe, expect, it } from "vitest"

import {
  cardChoiceFor,
  cardChoicesFor,
  categoriesForLabels,
  categoryGrantOk,
  consentActionFor,
  normalizePattern,
  patternMatches,
  resolvePermission,
  ruleFromCardChoice,
  type PermissionContext,
} from "./permissions.js"

const base: PermissionContext = { action: "accept_site_terms", host: "acme.gupy.io", settings: {}, rules: [] }

describe("patternMatches", () => {
  it("wildcards match subdomains and the apex", () => {
    expect(patternMatches("*.gupy.io", "acme.gupy.io")).toBe(true)
    expect(patternMatches("*.gupy.io", "a.b.gupy.io")).toBe(true)
    expect(patternMatches("*.gupy.io", "gupy.io")).toBe(true)
    expect(patternMatches("*.gupy.io", "evilgupy.io")).toBe(false)
    expect(patternMatches("*.gupy.io", "gupy.io.evil.com")).toBe(false)
  })
  it("exact patterns match only the host (and www)", () => {
    expect(patternMatches("gupy.io", "gupy.io")).toBe(true)
    expect(patternMatches("gupy.io", "www.gupy.io")).toBe(true)
    expect(patternMatches("gupy.io", "acme.gupy.io")).toBe(false)
  })
  it("normalizes user input", () => {
    expect(normalizePattern(" https://Acme.Gupy.io/vagas?x=1 ")).toBe("acme.gupy.io")
    expect(normalizePattern("*.gupy.io")).toBe("*.gupy.io")
    expect(normalizePattern("*")).toBeNull()
    expect(normalizePattern("*.io")).toBeNull()
  })
})

describe("resolvePermission precedence", () => {
  const allow = { action: "accept_site_terms" as const, pattern: "*.gupy.io", effect: "allow" as const }
  const deny = { ...allow, effect: "deny" as const, pattern: "acme.gupy.io" }
  it("defaults to ask", () => expect(resolvePermission(base).decision).toBe("ask"))
  it("deny rule beats allow rule and auto mode", () => {
    const r = resolvePermission({ ...base, settings: { accept_site_terms: { mode: "auto" } }, rules: [allow, deny] })
    expect(r).toMatchObject({ decision: "deny", reason: "deny_rule" })
  })
  it("high-risk site beats allow rule and auto", () => {
    const r = resolvePermission({ ...base, siteRisk: "alto", settings: { accept_site_terms: { mode: "auto" } }, rules: [allow] })
    expect(r).toMatchObject({ decision: "ask", reason: "high_risk_site" })
  })
  it("allow rule applies in allowlist mode, not in ask mode", () => {
    expect(resolvePermission({ ...base, settings: { accept_site_terms: { mode: "allowlist" } }, rules: [allow] })).toMatchObject({ decision: "allow", reason: "allow_rule" })
    expect(resolvePermission({ ...base, rules: [allow] }).decision).toBe("ask")
    expect(resolvePermission({ ...base, host: "other.com", settings: { accept_site_terms: { mode: "allowlist" } }, rules: [allow] }).reason).toBe("not_listed")
  })
  it("auto mode allows everything not denied", () => {
    expect(resolvePermission({ ...base, settings: { accept_site_terms: { mode: "auto" } } })).toMatchObject({ decision: "allow", reason: "mode_auto" })
  })
  it("rules are per action", () => {
    const r = resolvePermission({ ...base, action: "create_site_account", settings: { create_site_account: { mode: "allowlist" } }, rules: [allow] })
    expect(r.decision).toBe("ask")
  })
})

describe("guardrails", () => {
  it("marketing opt-in defaults to deny", () => {
    expect(resolvePermission({ ...base, action: "accept_marketing_optin" })).toMatchObject({ decision: "deny", reason: "mode_deny" })
  })
  it("final submit auto needs the extra confirmation", () => {
    const settings = { final_submit: { mode: "auto" as const } }
    expect(resolvePermission({ ...base, action: "final_submit", settings }).reason).toBe("final_submit_unconfirmed")
    expect(resolvePermission({ ...base, action: "final_submit", settings: { final_submit: { mode: "auto", confirmedAt: "2026-10-23T00:00:00Z" } } }).decision).toBe("allow")
  })
  it("auto proceeds only when every touched category is confirmed", () => {
    const settings = { accept_site_terms: { mode: "auto" as const, categories: ["termos" as const] } }
    expect(resolvePermission({ ...base, settings, categories: ["termos"] }).decision).toBe("allow")
    const r = resolvePermission({ ...base, settings, categories: ["termos", "saude"] })
    expect(r).toMatchObject({ decision: "ask", reason: "missing_category", missing: ["saude"] })
  })
  it("sensitive categories can be auto-allowed once confirmed on the rule", () => {
    const rule = { action: "accept_site_terms" as const, pattern: "*.gupy.io", effect: "allow" as const, categories: ["termos", "diversidade"] as const }
    const settings = { accept_site_terms: { mode: "allowlist" as const } }
    expect(resolvePermission({ ...base, settings, rules: [rule], categories: ["termos", "diversidade"] }).decision).toBe("allow")
    expect(resolvePermission({ ...base, settings, rules: [{ ...rule, categories: ["termos"] }], categories: ["termos", "diversidade"] }).missing).toEqual(["diversidade"])
  })
  it("deny and high risk still win over confirmed categories", () => {
    const settings = { accept_site_terms: { mode: "auto" as const, categories: ["termos" as const] } }
    expect(resolvePermission({ ...base, settings, siteRisk: "alto", categories: ["termos"] }).reason).toBe("high_risk_site")
    expect(resolvePermission({ ...base, settings, rules: [{ action: "accept_site_terms", pattern: "acme.gupy.io", effect: "deny" }], categories: ["termos"] }).reason).toBe("deny_rule")
  })
  it("sensitive grants need the typed confirmation", () => {
    expect(categoryGrantOk(["termos"], null)).toBe(true)
    expect(categoryGrantOk([], null)).toBe(false)
    expect(categoryGrantOk(["termos", "saude"], "")).toBe(false)
    expect(categoryGrantOk(["termos", "saude"], "autorizo dados sensiveis")).toBe(true)
  })
  it("classifies labels into categories", () => {
    expect(consentActionFor("Li e aceito os Termos de Uso")).toEqual({ action: "accept_site_terms", categories: ["termos"] })
    expect(consentActionFor("Quero receber ofertas e novidades")).toMatchObject({ action: "accept_marketing_optin" })
    expect(consentActionFor("Autorizo o uso dos meus dados de diversidade (raça e gênero)").categories).toContain("diversidade")
    expect(consentActionFor("Consinto com o tratamento de dados de saúde").categories).toContain("saude")
    expect(categoriesForLabels(["CPF", "Pretensão salarial", "Estado civil", "Você é PcD?"])).toEqual(["documentos", "salario", "familia", "saude"])
  })
})

describe("card choices", () => {
  it("maps labels and persists rules", () => {
    expect(cardChoiceFor("Sempre permitir neste site")).toBe("always")
    expect(cardChoiceFor("Aceito")).toBeNull()
    expect(ruleFromCardChoice("always", "accept_site_terms", "acme.gupy.io", "ask")).toEqual({
      rule: { action: "accept_site_terms", pattern: "acme.gupy.io", effect: "allow", categories: [] },
      mode: "allowlist",
    })
    expect(ruleFromCardChoice("denyAlways", "create_site_account", "x.com", "auto")).toEqual({
      rule: { action: "create_site_account", pattern: "x.com", effect: "deny" },
      mode: "auto",
    })
    expect(ruleFromCardChoice("once", "accept_site_terms", "x.com", "ask")).toBeNull()
  })
  it("never offers 'always' for high-risk sites or final submit", () => {
    expect(cardChoicesFor({ action: "accept_site_terms" })).toContain("always")
    expect(cardChoicesFor({ action: "accept_site_terms", siteRisk: "alto" })).not.toContain("always")
    expect(cardChoicesFor({ action: "final_submit" })).not.toContain("always")
  })
})
