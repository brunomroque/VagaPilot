import { describe, expect, it } from "vitest"

import {
  findDateMentions,
  parseDeadline,
  parseInterviewTime,
  parseIsoWithOffset,
  toZonedIso,
} from "./email-dates.js"

/** 20/10/2026 10:00 in São Paulo (UTC-3). */
const received = new Date("2026-10-20T13:00:00Z")

describe("CA11.2 deadlines in America/Sao_Paulo", () => {
  it.each([
    ["Conclua o teste até 25/10 às 23:59.", "2026-10-26T02:59:00.000Z"],
    ["Prazo: 25/10/2026 18h", "2026-10-25T21:00:00.000Z"],
    [
      "O desafio deve ser entregue até o dia 27 de outubro às 12h30.",
      "2026-10-27T15:30:00.000Z",
    ],
    [
      "Please complete the assessment by October 28, 2026 at 11:59 PM.",
      "2026-10-29T02:59:00.000Z",
    ],
    ["Deadline: 29 Oct 6pm (horário de Brasília)", "2026-10-29T21:00:00.000Z"],
    ["Responda até 30/10.", "2026-10-31T02:59:00.000Z"],
    ["Você tem até 2026-11-02 09:00 para enviar.", "2026-11-02T12:00:00.000Z"],
    ["Envie em até 3 dias.", "2026-10-24T02:59:00.000Z"],
    ["Complete within 48 hours.", "2026-10-22T13:00:00.000Z"],
    ["Due by 31/10 23:00 UTC", "2026-10-31T23:00:00.000Z"],
  ])("%s", (text, expected) => {
    expect(parseDeadline(text, received)?.toISOString()).toBe(expected)
  })

  it("rolls a day-month without year into the next year when it already passed", () => {
    const december = new Date("2026-12-20T13:00:00Z")
    expect(
      parseDeadline("Prazo até 05/01 às 10:00", december)?.toISOString()
    ).toBe("2027-01-05T13:00:00.000Z")
  })

  it("ignores dates without a deadline cue unless asked to fall back", () => {
    const text =
      "Recebemos sua candidatura em 18/10. Teste disponível em 22/10 14:00."
    expect(parseDeadline(text, received)).toBeNull()
    expect(
      parseDeadline(text, received, { fallbackToFirst: true })?.toISOString()
    ).toBe("2026-10-22T17:00:00.000Z")
  })

  it("does not read bare numbers as times", () => {
    const [mention] = findDateMentions("Até 25/10 3 vagas abertas", received)
    expect(mention?.hasTime).toBe(false)
    expect(mention?.at.toISOString()).toBe("2026-10-26T02:59:00.000Z")
  })

  it("rejects impossible dates", () => {
    expect(parseDeadline("até 31/02 às 10:00", received)).toBeNull()
    expect(parseDeadline("até 25/10 às 25:00", received)?.toISOString()).toBe(
      "2026-10-26T02:59:00.000Z"
    )
  })

  it("finds the interview time of an invite", () => {
    expect(
      parseInterviewTime(
        "Gostaríamos de conversar na quarta, 28/10, às 14h. Confirme até 26/10.",
        received
      )?.toISOString()
    ).toBe("2026-10-28T17:00:00.000Z")
  })

  it("formats and validates ISO-8601 with offset (10.5)", () => {
    expect(toZonedIso(new Date("2026-10-26T02:59:00Z"))).toBe(
      "2026-10-25T23:59:00-03:00"
    )
    expect(parseIsoWithOffset("2026-10-25T23:59:00-03:00")?.toISOString()).toBe(
      "2026-10-26T02:59:00.000Z"
    )
    expect(parseIsoWithOffset("2026-10-25T23:59:00")).toBeNull()
    expect(parseIsoWithOffset("amanhã")).toBeNull()
  })
})
