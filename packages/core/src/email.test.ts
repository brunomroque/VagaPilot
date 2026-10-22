import { describe, expect, it } from "vitest"

import {
  buildDuplicateSearchQuery,
  buildGmailSearchQuery,
  isAtsSenderDomain,
  looksLikeVerificationCode,
  parseEmailAddress,
  prefilterEmail,
  SNIPPET_MAX_CHARS,
  toSnippet,
} from "./email.js"

const companies = ["Loft", "Empresa Fictícia Alfa Ltda."]

function prefilter(from: string, subject: string) {
  return prefilterEmail({ from: parseEmailAddress(from), subject, companies })
}

describe("Gmail search query (RF11.2)", () => {
  it("covers the ATS domains of P4.2, LinkedIn alerts, PT/EN terms and companies", () => {
    const query = buildGmailSearchQuery({ newerThanDays: 90, companies })
    expect(query.startsWith("newer_than:90d (")).toBe(true)
    for (const domain of [
      "gupy.io",
      "inhire.app",
      "greenhouse.io",
      "lever.co",
      "myworkday.com",
      "successfactors",
      "quickin",
      "jobbol",
      "solides",
      "jobalerts-noreply@linkedin.com",
    ]) {
      expect(query).toContain(domain)
    }
    expect(query).toContain('"processo seletivo"')
    expect(query).toContain("interview")
    expect(query).toContain('"Empresa Fictícia Alfa Ltda."')
    expect(query).toContain(" OR Loft")
  })

  it("RF5.2 duplicate query searches 12 months by ATS/company domain, company and role", () => {
    const query = buildDuplicateSearchQuery({
      company: "Loft",
      role: "Gerente de Plataforma",
      domains: ["https://www.loft.com.br/vagas"],
    })
    expect(query).toContain("newer_than:365d")
    expect(query).toContain("loft.com.br")
    expect(query).toContain('"Gerente de Plataforma"')
    expect(query).toContain("candidatura OR application")
  })
})

describe("prefilter on headers only (RF11.3)", () => {
  it("reads known ATS senders, alerts, recruiting subjects and application companies", () => {
    expect(prefilter("Gupy <no-reply@gupy.io>", "Atualização")).toEqual({
      action: "read",
      reason: "ats_sender",
    })
    expect(
      prefilter("x <notify@empresa.successfactors.eu>", "Update").action
    ).toBe("read")
    expect(
      prefilter("LinkedIn <jobalerts-noreply@linkedin.com>", "Novas vagas")
    ).toEqual({
      action: "read",
      reason: "job_alert",
    })
    expect(prefilter("RH <rh@exemplo.test>", "Sua candidatura").reason).toBe(
      "recruiting_term"
    )
    expect(prefilter("Time Loft <talentos@loft.com.br>", "Olá!").reason).toBe(
      "company"
    )
  })

  it("never opens messages outside the filter", () => {
    expect(prefilter("Loja <ofertas@loja.test>", "50% de desconto")).toEqual({
      action: "skip",
      reason: "outside_filter",
    })
  })

  it("CA11.6 verification-code e-mails are skipped on the subject alone (no consent)", () => {
    for (const subject of [
      "Seu código de verificação Gupy",
      "Código de acesso: use em 10 minutos",
      "Your verification code",
      "One-time passcode for Greenhouse",
    ]) {
      expect(looksLikeVerificationCode(subject), subject).toBe(true)
      expect(prefilter("Gupy <no-reply@gupy.io>", subject)).toEqual({
        action: "skip",
        reason: "verification_code",
      })
    }
    expect(looksLikeVerificationCode("Teste técnico: prazo até 25/10")).toBe(
      false
    )
  })

  it("parses From headers and ATS domains", () => {
    expect(parseEmailAddress('"Time Gupy" <No-Reply@Gupy.io>')).toEqual({
      name: "Time Gupy",
      address: "no-reply@gupy.io",
      domain: "gupy.io",
    })
    expect(parseEmailAddress("rh@exemplo.test").domain).toBe("exemplo.test")
    expect(isAtsSenderDomain("mail.myworkday.com")).toBe(true)
    expect(isAtsSenderDomain("gupy.io.attacker.test")).toBe(false)
  })
})

describe("snippet (RF11.4, CA11.4)", () => {
  it("keeps at most 500 characters, collapsed and cut on a word", () => {
    const body = `Olá Marina, ${"texto fictício ".repeat(80)}fim`
    const snippet = toSnippet(body)
    expect(snippet.length).toBeLessThanOrEqual(SNIPPET_MAX_CHARS)
    expect(snippet.endsWith("…")).toBe(true)
    expect(body).not.toBe(snippet)
    expect(toSnippet("  curto\n\n texto ")).toBe("curto texto")
  })
})
