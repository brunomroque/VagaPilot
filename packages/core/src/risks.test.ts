import { describe, expect, it } from "vitest"
import {
  RISK_CATALOG,
  isConsentLabel,
  isLowConfidenceField,
  riskAlerts,
  siteRiskLevel,
} from "./risks.js"

describe("risk catalog", () => {
  it("covers every required risk with text", () => {
    expect(RISK_CATALOG.map((r) => r.id)).toEqual(
      expect.arrayContaining([
        "sites_bloqueiam_bots",
        "termos_de_sites",
        "contas_e_senhas",
        "email_e_links",
        "erros_ia",
        "receita_desatualizada",
        "linkedin",
        "navegador_local",
        "provedores_exterior",
        "cotas",
        "responsabilidade",
      ])
    )
    for (const r of RISK_CATALOG)
      expect(r.title && r.short && r.more).toBeTruthy()
  })

  it("detects consent-like labels", () => {
    for (const l of [
      "Li e aceito os Termos de Uso",
      "I agree to the Privacy Policy",
      "Aceito receber comunicações de marketing",
      "Concordo com a LGPD",
      "Autorizo o tratamento dos meus dados pessoais",
    ])
      expect(isConsentLabel(l)).toBe(true)
    for (const l of ["Nome completo", "Possui CNH?", "Cidade"])
      expect(isConsentLabel(l)).toBe(false)
  })

  it("matches the most specific domain", () => {
    const levels = [
      { domain: "example.com", level: "medio" as const },
      { domain: "jobs.example.com", level: "alto" as const },
    ]
    expect(siteRiskLevel("a.jobs.example.com", levels)).toBe("alto")
    expect(siteRiskLevel("www.example.com", levels)).toBe("medio")
    expect(siteRiskLevel("notexample.com", levels)).toBeNull()
  })

  it("triggers contextual alerts", () => {
    expect(riskAlerts({}).length).toBe(0)
    const ids = riskAlerts({
      siteLevel: "alto",
      creatingAccount: true,
      consentPending: true,
      lowConfidence: 2,
      recipeStatus: "stale",
      atReview: true,
    }).map((a) => a.id)
    expect(ids).toEqual([
      "sites_bloqueiam_bots",
      "termos_de_sites",
      "contas_e_senhas",
      "receita_desatualizada",
      "erros_ia",
      "responsabilidade",
    ])
    expect(riskAlerts({ siteLevel: "baixo", recipeStatus: "trusted" })).toEqual(
      []
    )
    expect(riskAlerts({ recipeStatus: "learning" })[0]?.id).toBe(
      "receita_desatualizada"
    )
    const localAlert = riskAlerts({ browserProvider: "local" })[0]
    expect(localAlert?.id).toBe("navegador_local")
    expect(localAlert?.detail).toContain("Chrome local")
    const cloudAlert = riskAlerts({ browserProvider: "browserbase" })[0]
    expect(cloudAlert?.id).toBe("navegador_local")
    expect(cloudAlert?.detail).toContain("Browserbase")
  })

  it("flags low-confidence answers", () => {
    expect(
      isLowConfidenceField({
        label: "Qual sua pretensão salarial",
        value: "5000",
      })
    ).toBe(true)
    expect(
      isLowConfidenceField({
        label: "Por que quer trabalhar aqui?",
        value: "x",
      })
    ).toBe(true)
    expect(isLowConfidenceField({ label: "E-mail", value: "a@b.com" })).toBe(
      false
    )
  })
})
