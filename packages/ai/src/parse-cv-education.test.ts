import { describe, expect, it } from "vitest"
import { educationFromText, foldKey } from "./parse-cv.js"

const CV = `Bruno Moreira Roque
Engenheiro de Software

Experiência Profissional
Empresa X — Engineering Manager
2020 – atual

Formação Acadêmica
Bacharelado em Ciência da Computação – Universidade Federal de Minas Gerais (2005 – 2009)
MBA em Gestão de Projetos
Fundação Getulio Vargas (FGV) | 2015

Idiomas
Inglês avançado
`

describe("educationFromText", () => {
  it("reads the Portuguese Formação Acadêmica layout", () => {
    const edu = educationFromText(CV)
    expect(edu).toHaveLength(2)
    expect(edu[0]).toMatchObject({
      degree: "Bacharelado em Ciência da Computação",
      institution: "Universidade Federal de Minas Gerais",
      level: "graduacao",
      startYear: 2005,
      endYear: 2009,
    })
    expect(edu[1]).toMatchObject({
      degree: "MBA em Gestão de Projetos",
      institution: "Fundação Getulio Vargas (FGV)",
      level: "mba",
      endYear: 2015,
    })
  })
  it("returns nothing without an education heading", () => {
    expect(educationFromText("Experiência\nEmpresa X")).toEqual([])
  })
  it("folds accents and case", () => {
    expect(foldKey(" Inglês  Avançado")).toBe(foldKey("ingles avancado"))
  })
})
