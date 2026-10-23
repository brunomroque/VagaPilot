import { describe, expect, it } from "vitest"

import {
  autoFilledEntries,
  buildSensitiveReport,
  categoryCounts,
  sensitiveEmailBody,
  sensitiveEmailSubject,
  shouldNotifySensitive,
} from "./sensitive-report.js"

const fields = [
  { question: "Nome completo", answer: "Ana", origin: "perfil" as const },
  { question: "Qual sua raça/cor?", answer: "Parda", origin: "regra" as const, confidence: 0.9 },
  { question: "Você é PcD?", answer: "Não", origin: "uma_vez" as const },
  { question: "Pretensão salarial", answer: "R$ 8.000", origin: "automatico" as const, confidence: 0.6 },
  { question: "Li e aceito os termos", answer: "Aceito", origin: "regra" as const, category: "termos" as const },
]

describe("sensitive report", () => {
  it("lists sensitive and notable fields with answer, category, origin and confidence", () => {
    const r = buildSensitiveReport("acme.gupy.io", fields)
    expect(r.entries.map((e) => e.category)).toEqual(["diversidade", "saude", "salario", "termos"])
    expect(r.entries[0]).toMatchObject({ question: "Qual sua raça/cor?", answer: "Parda", sensitive: true, origin: "regra", confidence: 0.9 })
    expect(r.entries.find((e) => e.question === "Nome completo")).toBeUndefined()
  })
  it("no notification when everything was approved one-time", () => {
    const r = buildSensitiveReport("x.com", [{ question: "Você é PcD?", answer: "Não", origin: "uma_vez" }])
    expect(r.entries).toHaveLength(1)
    expect(shouldNotifySensitive(r, true)).toBe(false)
  })
  it("notification lists only auto-filled fields and is off by default", () => {
    const r = buildSensitiveReport("acme.gupy.io", fields)
    expect(shouldNotifySensitive(r, false)).toBe(false)
    expect(shouldNotifySensitive(r, true)).toBe(true)
    expect(autoFilledEntries(r).map((e) => e.question)).toEqual(["Qual sua raça/cor?", "Pretensão salarial", "Li e aceito os termos"])
    const body = sensitiveEmailBody(r, "https://app")
    expect(body).toContain("Parda")
    expect(body).not.toContain("PcD")
  })
  it("subject never carries values", () => {
    const s = sensitiveEmailSubject("Acme")
    for (const f of fields) expect(s).not.toContain(f.answer)
    expect(s).not.toMatch(/ra[cç]a|PcD|sal[aá]ri/i)
  })
  it("admin counts never expose questions or answers", () => {
    const counts = categoryCounts(buildSensitiveReport("acme.gupy.io", fields))
    expect(counts).toEqual({ diversidade: 1, saude: 1, salario: 1, termos: 1 })
    const json = JSON.stringify(counts)
    for (const f of fields) {
      expect(json).not.toContain(f.answer)
      expect(json).not.toContain(f.question)
    }
  })
})
