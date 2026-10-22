import { describe, expect, it } from "vitest"

import {
  domainLabel,
  matchBlocklist,
  normalizeCompanyName,
  normalizeDomain,
  trigramSimilarity,
  type BlocklistEntry,
} from "./blocklist.js"

const acme: BlocklistEntry = { companyName: "Acme" }

describe("normalizeCompanyName", () => {
  it.each([
    ["ACME Ltda.", "acme"],
    ["Acme Brasil", "acme"],
    ["Acme S.A.", "acme"],
    ["Acme S/A", "acme"],
    ["Acme Group", "acme"],
    ["Acme Tecnologia Ltda", "acme"],
    ["Acme do Brasil", "acme"],
    ["  Ação & Cia  ", "acao e cia"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeCompanyName(input)).toBe(expected)
  })

  it("never normalizes a name to nothing", () => {
    expect(normalizeCompanyName("Grupo Brasil")).toBe("grupo brasil")
  })
})

describe("domains", () => {
  it("normalizes URLs, e-mails' hosts and bare domains", () => {
    expect(normalizeDomain("https://www.Acme.com.br/vagas?x=1")).toBe(
      "acme.com.br"
    )
    expect(normalizeDomain("careers.acme.com.br")).toBe("careers.acme.com.br")
    expect(normalizeDomain("")).toBe("")
  })

  it("extracts the registrable label", () => {
    expect(domainLabel("acme.com.br")).toBe("acme")
    expect(domainLabel("jobs.acme.io")).toBe("acme")
    expect(domainLabel("acme")).toBe("acme")
  })
})

describe("trigramSimilarity", () => {
  it("is 1 for equal strings and lower for different ones", () => {
    expect(trigramSimilarity("acme", "acme")).toBe(1)
    expect(trigramSimilarity("acme", "acne")).toBeLessThan(0.9)
    expect(trigramSimilarity("", "")).toBe(1)
  })
})

describe("matchBlocklist", () => {
  it("CA1.4 'Acme' blocks 'ACME Ltda.', 'Acme Brasil' and acme.com.br", () => {
    expect(matchBlocklist([acme], { company: "ACME Ltda." })?.reason).toBe(
      "name"
    )
    expect(matchBlocklist([acme], { company: "Acme Brasil" })?.reason).toBe(
      "name"
    )
    expect(matchBlocklist([acme], { domain: "acme.com.br" })?.reason).toBe(
      "domain"
    )
    expect(
      matchBlocklist([acme], { domain: "https://careers.acme.com.br/job/1" })
    ).not.toBeNull()
  })

  it("does not block unrelated companies", () => {
    expect(matchBlocklist([acme], { company: "Acne Labs" })).toBeNull()
    expect(matchBlocklist([acme], { company: "Nubank" })).toBeNull()
    expect(matchBlocklist([acme], { domain: "notacme.com.br" })).toBeNull()
    expect(matchBlocklist([acme], {})).toBeNull()
  })

  it("matches aliases and explicit domains, including subdomains", () => {
    const entry: BlocklistEntry = {
      companyName: "Empresa Fictícia S.A.",
      aliases: ["EFSA"],
      domains: ["ficticia.test"],
    }
    expect(matchBlocklist([entry], { company: "efsa" })?.reason).toBe("alias")
    expect(
      matchBlocklist([entry], { domain: "rh.ficticia.test" })?.reason
    ).toBe("domain")
  })

  it("uses trigram similarity ≥ 0.9 for near-identical names", () => {
    const entry: BlocklistEntry = {
      companyName: "Companhia Exemplar de Transportes Rodoviarios",
    }
    const match = matchBlocklist([entry], {
      company: "Companhia Exemplar de Transportes Rodoviario",
    })
    expect(match?.reason).toBe("similar")
    expect(match?.similarity).toBeGreaterThanOrEqual(0.9)
    expect(
      matchBlocklist([entry], { company: "Transportes Exemplo" })
    ).toBeNull()
  })

  it("prefers the stored normalized name", () => {
    expect(
      matchBlocklist([{ companyName: "x", normalizedName: "acme" }], {
        company: "Acme",
      })
    ).not.toBeNull()
  })
})
