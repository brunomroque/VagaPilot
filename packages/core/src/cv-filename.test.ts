import { describe, expect, it } from "vitest"

import { buildCvFilename, isCvLanguage } from "./cv-filename.js"

const marina = { firstName: "Marina", lastName: "Alves" }

describe("buildCvFilename", () => {
  it("CA3.1 uses the default neutral pattern", () => {
    expect(buildCvFilename(marina, "pt-BR")).toBe("CV-Marina-Alves-PT.pdf")
    expect(buildCvFilename(marina, "en")).toBe("CV-Marina-Alves-EN.pdf")
    expect(buildCvFilename(marina, "es", undefined, "docx")).toBe(
      "CV-Marina-Alves-ES.docx"
    )
  })

  it("CA3.1 honors a custom pattern and never carries the upload name", () => {
    expect(buildCvFilename(marina, "pt-BR", "{first}_{last}_CV")).toBe(
      "Marina_Alves_CV.pdf"
    )
    const name = buildCvFilename(marina, "pt-BR", "{full}-{lang}")
    expect(name).toBe("Marina-Alves-PT.pdf")
    expect(name).not.toMatch(/final|versao|ops/i)
  })

  it("transliterates accents and drops unsafe characters", () => {
    expect(
      buildCvFilename({ firstName: "João", lastName: "da Conceição" }, "pt-BR")
    ).toBe("CV-Joao-da-Conceicao-PT.pdf")
    expect(buildCvFilename(marina, "pt-BR", "../{first}/{unknown}{last}")).toBe(
      "Marina-Alves.pdf"
    )
  })

  it("falls back to the display name and to a safe default", () => {
    expect(buildCvFilename({ displayName: "Rafael Souza" }, "en")).toBe(
      "CV-Rafael-Souza-EN.pdf"
    )
    expect(buildCvFilename({}, "pt-BR", "{first}{last}")).toBe("CV-PT.pdf")
    expect(buildCvFilename(marina, "pt-BR", "   ")).toBe(
      "CV-Marina-Alves-PT.pdf"
    )
  })

  it("recognizes supported languages", () => {
    expect(isCvLanguage("pt-BR")).toBe(true)
    expect(isCvLanguage("fr")).toBe(false)
  })
})
