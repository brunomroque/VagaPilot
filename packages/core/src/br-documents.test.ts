import { describe, expect, it } from "vitest"

import { formatCpf, isValidCpfInput, onlyDigits } from "./br-documents.js"

describe("CPF input", () => {
  it("accepts valid check digits, formatted or bare (fictitious numbers)", () => {
    expect(isValidCpfInput("123.456.789-09")).toBe(true)
    expect(isValidCpfInput("52998224725")).toBe(true)
  })

  it("rejects wrong digits, repeated digits and wrong length", () => {
    expect(isValidCpfInput("123.456.789-00")).toBe(false)
    expect(isValidCpfInput("111.111.111-11")).toBe(false)
    expect(isValidCpfInput("1234")).toBe(false)
  })

  it("formats and strips", () => {
    expect(formatCpf("12345678909")).toBe("123.456.789-09")
    expect(formatCpf("12")).toBe("12")
    expect(onlyDigits("a1-2.3")).toBe("123")
  })
})
