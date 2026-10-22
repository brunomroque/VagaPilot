import { describe, expect, it } from "vitest"

import { verifyGrounding } from "./grounding.js"

const facts = [
  { id: "f1", statement: "Liderou migração de 40 serviços para Kubernetes" },
  { id: "f2", statement: "Certificação AWS Solutions Architect" },
]

describe("verifyGrounding (F8)", () => {
  it("accepts empty text", () => {
    expect(verifyGrounding("  ", [], facts)).toEqual({ ok: true })
  })

  it("blocks text without fact ids", () => {
    expect(verifyGrounding("Tenho experiência com Go", [], facts)).toEqual({
      ok: false,
      reason: "missing_facts",
    })
  })

  it("accepts text grounded in cited facts", () => {
    expect(
      verifyGrounding(
        "Liderou migração de 40 serviços para Kubernetes",
        ["f1"],
        facts
      )
    ).toEqual({ ok: true })
  })

  it("rejects unsupported claims", () => {
    expect(
      verifyGrounding(
        "Sou especialista em blockchain há 10 anos",
        ["f1"],
        facts
      )
    ).toEqual({ ok: false, reason: "unsupported_claim" })
  })
})
