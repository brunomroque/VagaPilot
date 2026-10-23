import { describe, expect, it } from "vitest"

import { normalizeLabel, partitionFields, pickOption, resolveField } from "../src/apply/resolver.js"
import type { FieldInfo } from "../src/apply/types.js"
import { samplePayload } from "./payload.js"

const field = (overrides: Partial<FieldInfo>): FieldInfo => ({
  key: "k",
  kind: "text",
  label: "",
  name: null,
  autocomplete: null,
  required: true,
  options: [],
  currentValue: null,
  ...overrides,
})

const ctx = { payload: samplePayload(), runAnswers: {}, cvPath: "/tmp/cv.pdf" }

describe("resolver", () => {
  it("normalises labels", () => {
    expect(normalizeLabel("  Você tem disponibilidade? * ")).toBe("voce tem disponibilidade")
  })
  it("picks options without guessing", () => {
    expect(pickOption(["Sim", "Não"], "nao")).toBe("Não")
    expect(pickOption(["Júnior", "Pleno", "Sênior"], "pleno")).toBe("Pleno")
    expect(pickOption(["A", "B"], "talvez")).toBeNull()
  })
  it("fills from profile, never sensitive fields", () => {
    expect(resolveField(field({ label: "E-mail", kind: "email", autocomplete: "email" }), ctx)?.value).toBe("bruno@example.com")
    expect(resolveField(field({ label: "Senha", kind: "text" }), ctx)).toBeNull()
    expect(resolveField(field({ label: "Currículo", kind: "file" }), ctx)?.source).toBe("cv")
  })
  it("unknown required questions go to the user; run answers win", () => {
    const q = field({ label: "Pretensão salarial?", kind: "text" })
    expect(partitionFields([q], ctx).unknown).toHaveLength(1)
    const answered = { ...ctx, runAnswers: { [normalizeLabel(q.label)]: "R$ 10.000" } }
    expect(partitionFields([q], answered).answers[0]?.answer).toMatchObject({ value: "R$ 10.000", source: "run_answer" })
    expect(partitionFields([field({ label: "Opcional", required: false })], ctx).unknown).toHaveLength(0)
  })
})

describe("hashPreview", async () => {
  const { hashPreview } = await import("../src/apply/runner.js")
  it("ignores key order (jsonb round trip)", () => {
    expect(hashPreview({ b: 1, a: { y: [1, { d: 2, c: 3 }], x: "s" } })).toBe(
      hashPreview({ a: { x: "s", y: [1, { c: 3, d: 2 }] }, b: 1 })
    )
  })
})

describe("consent checkboxes are never ticked by the automation", () => {
  const terms = field({ label: "Li e aceito os Termos de Uso e a Política de Privacidade", kind: "checkbox", linkHref: "https://ats.example/termos" })
  const marketing = field({ label: "Aceito receber comunicações de marketing", kind: "checkbox", required: false })

  it("ignores profile and standard answers for consent boxes", () => {
    const payload = samplePayload()
    const withStandard = {
      ...ctx,
      payload: { ...payload, standardAnswers: [...payload.standardAnswers, { key: "termos", questionExamples: [terms.label], answer: "sim", proposedFrom: null }] },
    }
    expect(resolveField(terms, withStandard as typeof ctx)).toBeNull()
    expect(resolveField(terms, { ...ctx, runAnswers: { [normalizeLabel(terms.label)]: "sim" } })).toBeNull()
  })

  it("turns a required consent box into an Aceito/Cancelar question with the terms link", () => {
    const { answers, unknown } = partitionFields([terms, marketing], ctx)
    expect(answers).toHaveLength(0)
    expect(unknown).toEqual([
      expect.objectContaining({ label: terms.label, options: ["Aceito", "Cancelar"], consent: { termsUrl: "https://ats.example/termos" } }),
    ])
  })

  it("asks even when the site pre-checked a required consent box, and unchecks optional marketing", () => {
    const pre = { ...terms, currentValue: "sim" }
    expect(partitionFields([pre], ctx).unknown).toHaveLength(1)
    const res = partitionFields([{ ...marketing, currentValue: "sim" }], ctx)
    expect(res.answers[0]?.answer.value).toBe("nao")
  })

  it("ticks only after the user's own Aceito; Cancelar never ticks", () => {
    const accepted = { ...ctx, runAnswers: { [normalizeLabel(terms.label)]: "Aceito" } }
    expect(partitionFields([terms], accepted).answers[0]?.answer).toMatchObject({ value: "sim", source: "run_answer" })
    const cancelled = { ...ctx, runAnswers: { [normalizeLabel(terms.label)]: "Cancelar" } }
    expect(resolveField(terms, cancelled)).toBeNull()
  })
})
