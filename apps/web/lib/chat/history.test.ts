import type { UIMessage } from "ai"
import { describe, expect, it } from "vitest"

import { isQuotaError, sanitizeHistory } from "./history"

const u = (id: string, text: string, extra: unknown[] = []): UIMessage =>
  ({ id, role: "user", parts: [{ type: "text", text }, ...extra] }) as UIMessage
const a = (id: string, parts: unknown[]): UIMessage =>
  ({ id, role: "assistant", parts }) as UIMessage

describe("sanitizeHistory", () => {
  it("drops widget tool parts, data parts and unanswered user turns", () => {
    const history = [
      u("1", "Segue anexo.", [
        { type: "data-attachments", data: { items: [] } },
      ]),
      a("2", [
        {
          type: "tool-attachment_intent",
          toolCallId: "x",
          state: "output-available",
          input: {},
          output: { kind: "options" },
        },
      ]),
      u("3", "print"),
      u("4", "Português"),
      a("5", [
        { type: "step-start" },
        {
          type: "tool-list_cv_tracks",
          toolCallId: "y",
          state: "output-available",
          input: {},
          output: {},
          callProviderMetadata: { google: { thoughtSignature: "abc" } },
        },
        { type: "text", text: "Qual trilha?" },
      ]),
      u("6", "sem resposta"),
    ]
    const out = sanitizeHistory(history, ["list_cv_tracks"])
    expect(out.map((m) => m.id)).toEqual(["1", "2", "4", "5"])
    expect(out[0]!.parts).toEqual([{ type: "text", text: "Segue anexo." }])
    expect(out[1]!.parts).toEqual([
      { type: "text", text: "(mostrei opções na tela)" },
    ])
    expect(out[3]!.parts).toEqual([
      { type: "text", text: "[ferramenta list_cv_tracks → {}]" },
      { type: "text", text: "Qual trilha?" },
    ])
  })

  it("drops an error reply together with its question", () => {
    const out = sanitizeHistory(
      [
        u("1", "oi"),
        a("2", [{ type: "text", text: "Olá!" }]),
        u("3", "x"),
        a("4", [{ type: "text", text: "Falhou." }]),
      ],
      [],
      ["Falhou."]
    )
    expect(out.map((m) => m.id)).toEqual(["1", "2"])
  })
})

describe("isQuotaError", () => {
  it("detects nested 429", () => {
    expect(
      isQuotaError({
        message: "Failed after 2 attempts",
        lastError: { statusCode: 429 },
      })
    ).toBe(true)
    expect(isQuotaError(new Error("boom"))).toBe(false)
  })
})
