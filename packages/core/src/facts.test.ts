import { describe, expect, it } from "vitest"

import {
  isExcerptInText,
  isFactKind,
  isUsableFact,
  normalizeForGrounding,
} from "./facts.js"

describe("facts rules", () => {
  it("only confirmed facts are usable by the agent (CA2.2)", () => {
    expect(isUsableFact({ status: "confirmado" })).toBe(true)
    expect(isUsableFact({ status: "proposto" })).toBe(false)
    expect(isUsableFact({ status: "rejeitado" })).toBe(false)
  })

  it("knows the fact kinds", () => {
    expect(isFactKind("metrica")).toBe(true)
    expect(isFactKind("hobby")).toBe(false)
  })

  it("normalizes accents, dashes, bullets and spaces", () => {
    expect(normalizeForGrounding("  • Liderou  time — 25 ENGENHEIROS ")).toBe(
      "liderou time - 25 engenheiros"
    )
  })

  it("finds excerpts despite formatting differences and rejects invented ones", () => {
    const cv =
      "Experiência\n• Liderou   a migração de 40 serviços\npara Kubernetes."
    expect(
      isExcerptInText("liderou a migracao de 40 servicos para kubernetes", cv)
    ).toBe(true)
    expect(isExcerptInText("Certificação AWS Solutions Architect", cv)).toBe(
      false
    )
    expect(isExcerptInText("a", cv)).toBe(false)
    expect(isExcerptInText("Go", "Competências: Kubernetes, Go, Python")).toBe(
      true
    )
    expect(isExcerptInText("go", "Liderou o Google Cloud")).toBe(false)
  })
})

import { factCanonicalKey, spellingFromSource } from "./facts.js"

describe("factCanonicalKey", () => {
  it("merges filler and accent variants", () => {
    const k = factCanonicalKey("Inglês Avançado")
    expect(factCanonicalKey("Possui ingles avancado")).toBe(k)
    expect(factCanonicalKey("Possui inglês avançado.")).toBe(k)
    expect(factCanonicalKey("Possui competência em Kubernetes")).toBe(
      "kubernetes"
    )
    expect(factCanonicalKey("Tem experiência com Kubernetes")).toBe(
      "kubernetes"
    )
    expect(factCanonicalKey("Conhecimento em Kubernetes")).toBe("kubernetes")
    expect(factCanonicalKey("Kubernetes")).toBe("kubernetes")
    expect(factCanonicalKey("Liderou time de 8 pessoas")).toBe(
      "liderou time de 8 pessoas"
    )
  })
})

describe("spellingFromSource", () => {
  it("keeps the CV spelling", () => {
    expect(spellingFromSource("Vital", "2021 – atual | V.tal — Gerente")).toBe(
      "V.tal"
    )
    expect(spellingFromSource("Itau", "Itaú Unibanco")).toBe("Itaú")
    expect(spellingFromSource("Acme", "nada aqui")).toBe("Acme")
  })
})

import { factsSimilar } from "./facts.js"

describe("factsSimilar", () => {
  it("joins the 40-people variants", () => {
    const a = "Gerenciou equipe de ~40 pessoas"
    expect(factsSimilar(a, "Gerenciamento de equipe de 40 pessoas")).toBe(true)
    expect(factsSimilar(a, "Liderou 40 pessoas em Operações")).toBe(true)
    expect(factsSimilar("Liderou 40 pessoas em Operações de TI", a)).toBe(true)
  })
  it("ignores filler lead-ins for short competency facts", () => {
    expect(
      factsSimilar(
        "Possui experiência com jornadas de usuário",
        "Atuação com jornadas de usuário"
      )
    ).toBe(true)
    expect(
      factsSimilar(
        "Experiência com jornadas de usuário",
        "Experiência com testes de usabilidade"
      )
    ).toBe(false)
  })
  it("merges jornada facts when company names are ignored", () => {
    expect(
      factsSimilar(
        "Possui experiencia com jornadas de usuario",
        "Experiência com jornadas de usuário na Accenture",
        { ignore: ["Accenture"] }
      )
    ).toBe(true)
    expect(
      factsSimilar(
        "Possui experiencia com jornadas de usuario",
        "Experiência com jornadas de usuário na Accenture"
      )
    ).toBe(false)
  })
  it("keeps distinct facts apart", () => {
    expect(
      factsSimilar(
        "Gerenciou equipe de 40 pessoas",
        "Gerenciou equipe de 12 pessoas"
      )
    ).toBe(false)
    expect(
      factsSimilar(
        "Reduziu custos de cloud em 40%",
        "Gerenciou equipe de 40 pessoas"
      )
    ).toBe(false)
    expect(factsSimilar("Kubernetes", "Terraform")).toBe(false)
    expect(
      factsSimilar(
        "Implantou observabilidade com Datadog",
        "Implantou CI/CD com GitHub Actions"
      )
    ).toBe(false)
  })
})
