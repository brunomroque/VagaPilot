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
