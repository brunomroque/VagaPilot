import { describe, expect, it } from "vitest"
import {
  decideFormSalaryBracket,
  isSalaryBracketField,
  parseBrSalaryAmount,
  parseSalaryBracketOption,
  SALARY_FORM_BLOCK_REASON,
} from "./salary-bracket.js"

describe("parseBrSalaryAmount", () => {
  it("parses BRL and shorthand", () => {
    expect(parseBrSalaryAmount("R$ 15.001")).toBe(15001)
    expect(parseBrSalaryAmount("até 10k")).toBe(10000)
    expect(parseBrSalaryAmount("10 mil")).toBe(10000)
    expect(parseBrSalaryAmount("Acima de R$ 25.000")).toBe(25000)
  })
})

describe("parseSalaryBracketOption", () => {
  it("parses common BR range labels", () => {
    expect(parseSalaryBracketOption("R$ 15.001 a R$ 20.000")).toEqual({
      min: 15001,
      max: 20000,
    })
    expect(parseSalaryBracketOption("Acima de R$ 25.000")).toEqual({
      min: 25000,
      max: null,
    })
    expect(parseSalaryBracketOption("Até 10k")).toEqual({
      min: null,
      max: 10000,
    })
  })
})

describe("decideFormSalaryBracket", () => {
  const options = [
    "Até R$ 10.000",
    "R$ 10.001 a R$ 15.000",
    "R$ 15.001 a R$ 20.000",
    "Acima de R$ 25.000",
  ]

  it("pauses when every upper bound is below target", () => {
    const lowOnly = [
      "Até R$ 10.000",
      "R$ 10.001 a R$ 15.000",
      "R$ 15.001 a R$ 20.000",
    ]
    expect(decideFormSalaryBracket(lowOnly, 32000)).toEqual({
      action: "pause",
      reason: SALARY_FORM_BLOCK_REASON,
    })
  })

  it("picks the lowest bracket that covers the target", () => {
    expect(decideFormSalaryBracket(options, 16000)).toEqual({
      action: "pick",
      option: "R$ 15.001 a R$ 20.000",
    })
    expect(decideFormSalaryBracket(options, 26000)).toEqual({
      action: "pick",
      option: "Acima de R$ 25.000",
    })
  })

  it("returns none when options do not look like brackets", () => {
    expect(decideFormSalaryBracket(["Sim", "Não"], 10000)).toEqual({
      action: "none",
    })
  })
})

describe("isSalaryBracketField", () => {
  it("detects salary bracket selects", () => {
    expect(
      isSalaryBracketField("Pretensão salarial", [
        "R$ 15.001 a R$ 20.000",
        "Acima de R$ 25.000",
      ])
    ).toBe(true)
    expect(isSalaryBracketField("Cidade", ["São Paulo", "Rio"])).toBe(false)
  })
})
