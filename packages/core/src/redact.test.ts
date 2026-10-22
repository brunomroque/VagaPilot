import { describe, expect, it } from "vitest"

import {
  isValidCpf,
  REDACTED_BINARY,
  REDACTED_CIRCULAR,
  REDACTED_CPF,
  REDACTED_EMAIL,
  REDACTED_PHONE,
  REDACTED_SECRET,
  redactPII,
  redactPIIText,
} from "./redact.js"

// Fictional data only. 529.982.247-25 is the canonical test CPF.
const CPF_FORMATTED = "529.982.247-25"
const CPF_BARE = "52998224725"

describe("isValidCpf", () => {
  it("validates check digits", () => {
    expect(isValidCpf(CPF_BARE)).toBe(true)
    expect(isValidCpf("52998224724")).toBe(false)
    expect(isValidCpf("11111111111")).toBe(false)
  })
})

describe("redactPIIText", () => {
  it.each([
    [`CPF ${CPF_FORMATTED}.`, `CPF ${REDACTED_CPF}.`],
    [`cpf=${CPF_BARE}`, `cpf=${REDACTED_CPF}`],
    ["ana.ficticia+vagas@exemplo.com.br", REDACTED_EMAIL],
    ["Fale com ANA@EXEMPLO.COM hoje", `Fale com ${REDACTED_EMAIL} hoje`],
    ["+55 (11) 98765-4321", REDACTED_PHONE],
    ["+5511987654321", REDACTED_PHONE],
    ["(21) 3333-4444", REDACTED_PHONE],
    ["11 98765 4321", REDACTED_PHONE],
    ["11987654321", REDACTED_PHONE],
    ["ligue 98765-4321", `ligue ${REDACTED_PHONE}`],
  ])("masks %s", (input, expected) => {
    expect(redactPIIText(input)).toBe(expected)
  })

  it.each([
    "2026-10-21T11:49:00.000Z",
    "00000000-0000-4000-8000-00000000000a",
    "R$ 12.000,00",
    "CEP 01310-100",
    "192.168.0.1",
    "vaga 12345",
  ])("keeps non-PII %s", (input) => {
    expect(redactPIIText(input)).toBe(input)
  })
})

describe("redactPII", () => {
  it("redacts nested objects and arrays", () => {
    const input = {
      candidate: {
        contacts: [`email: ana@exemplo.com`, { phone: "(11) 98765-4321" }],
        document: CPF_FORMATTED,
      },
      numericCpf: 52998224725,
      count: 3,
      ok: true,
      missing: null,
      at: new Date("2026-10-21T00:00:00Z"),
    }
    expect(redactPII(input)).toEqual({
      candidate: {
        contacts: [`email: ${REDACTED_EMAIL}`, { phone: REDACTED_PHONE }],
        document: REDACTED_CPF,
      },
      numericCpf: REDACTED_CPF,
      count: 3,
      ok: true,
      missing: null,
      at: new Date("2026-10-21T00:00:00Z"),
    })
  })

  it("does not mutate the input", () => {
    const input = { email: "ana@exemplo.com" }
    redactPII(input)
    expect(input.email).toBe("ana@exemplo.com")
  })

  it("drops values under secret-looking keys and redacts keys", () => {
    expect(
      redactPII({
        senha: "hunter2",
        accessToken: "abc",
        otpCode: "123456",
        "ana@exemplo.com": "x",
      })
    ).toEqual({
      senha: REDACTED_SECRET,
      accessToken: REDACTED_SECRET,
      otpCode: REDACTED_SECRET,
      [REDACTED_EMAIL]: "x",
    })
  })

  it("masks binary and survives cycles", () => {
    const node: Record<string, unknown> = { bytes: new Uint8Array([1, 2]) }
    node.self = node
    expect(redactPII(node)).toEqual({
      bytes: REDACTED_BINARY,
      self: REDACTED_CIRCULAR,
    })
  })

  it("keeps shared (non-circular) references", () => {
    const shared = { email: "ana@exemplo.com" }
    expect(redactPII({ a: shared, b: shared })).toEqual({
      a: { email: REDACTED_EMAIL },
      b: { email: REDACTED_EMAIL },
    })
  })
})
