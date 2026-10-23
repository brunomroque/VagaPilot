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
