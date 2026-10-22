import { describe, expect, it } from "vitest"

import type { ClassifierClass } from "./email.js"
import type { LinkResult } from "./email-linking.js"
import {
  decideEmailOutcome,
  nextActionForEmailClass,
  shouldWriteNextAction,
  statusForEmailClass,
} from "./email-outcome.js"
import type { ApplicationStatus } from "./status.js"

const strong: LinkResult = {
  applicationId: "app-1",
  score: 0.9,
  ambiguous: false,
  candidates: [{ applicationId: "app-1", score: 0.9 }],
}
const none: LinkResult = {
  applicationId: null,
  score: 0,
  ambiguous: false,
  candidates: [],
}

function decide(
  classification: ClassifierClass,
  confidence: number,
  currentStatus: ApplicationStatus | null,
  link: LinkResult = strong,
  hasCompany = true
) {
  return decideEmailOutcome({
    classification,
    confidence,
    link,
    currentStatus: link.applicationId ? currentStatus : null,
    hasCompany,
  })
}

describe("e-mail outcome (P4.3, RF11.3–RF11.7, 9.4)", () => {
  it("maps classes to statuses (J5)", () => {
    expect(statusForEmailClass("reprovacao")).toBe("reprovada")
    expect(statusForEmailClass("teste_etapa")).toBe("etapa_pendente")
    expect(statusForEmailClass("convite_entrevista")).toBe("entrevista")
    expect(statusForEmailClass("confirmacao")).toBe("enviada")
    expect(statusForEmailClass("recrutador_contato")).toBeNull()
    expect(nextActionForEmailClass("teste_etapa")).toBeTruthy()
    expect(nextActionForEmailClass("reprovacao")).toBeNull()
  })

  it("CA11.5 applies a confident forward change with a strong link", () => {
    expect(decide("reprovacao", 0.93, "em_analise")).toEqual({
      kind: "apply",
      applicationId: "app-1",
      from: "em_analise",
      to: "reprovada",
    })
    expect(decide("teste_etapa", 0.8, "enviada")).toMatchObject({
      kind: "apply",
    })
    expect(decide("confirmacao", 0.9, "rascunho")).toMatchObject({
      kind: "apply",
      to: "enviada",
    })
  })

  it("CA11.5 below 0,8 always goes to Revise", () => {
    for (const confidence of [0, 0.5, 0.79]) {
      expect(decide("convite_entrevista", confidence, "em_analise")).toEqual({
        kind: "review",
        applicationId: "app-1",
        suggestedStatus: "entrevista",
        reason: "needs_review",
      })
    }
  })

  it("never leaves a terminal status nor regresses automatically", () => {
    expect(decide("convite_entrevista", 0.99, "reprovada")).toMatchObject({
      kind: "review",
      reason: "terminal_requires_user",
    })
    expect(decide("teste_etapa", 0.99, "entrevista")).toMatchObject({
      kind: "review",
      reason: "regression",
    })
    expect(decide("reprovacao", 0.99, "rascunho")).toMatchObject({
      kind: "review",
      reason: "not_allowed",
    })
  })

  it("only links when nothing changes (same status, recruiter, late confirmation)", () => {
    expect(decide("teste_etapa", 0.95, "etapa_pendente")).toEqual({
      kind: "link",
      applicationId: "app-1",
    })
    expect(decide("recrutador_contato", 0.9, "em_analise")).toMatchObject({
      kind: "link",
    })
    expect(decide("confirmacao", 0.95, "em_analise")).toMatchObject({
      kind: "link",
    })
  })

  it("sends weak or ambiguous links to Revise", () => {
    expect(
      decide("reprovacao", 0.95, "enviada", { ...strong, score: 0.5 })
    ).toMatchObject({ kind: "review", reason: "weak_link" })
    expect(
      decide("reprovacao", 0.95, "enviada", {
        applicationId: null,
        score: 0.6,
        ambiguous: true,
        candidates: [
          { applicationId: "a", score: 0.6 },
          { applicationId: "b", score: 0.55 },
        ],
      })
    ).toEqual({
      kind: "review",
      applicationId: "a",
      suggestedStatus: "reprovada",
      reason: "ambiguous_link",
    })
  })

  it("RF11.7 a confident confirmation without application creates one", () => {
    expect(decide("confirmacao", 0.9, null, none)).toEqual({
      kind: "create",
      status: "enviada",
    })
    expect(decide("confirmacao", 0.9, null, none, false)).toMatchObject({
      kind: "review",
      reason: "no_application",
    })
    expect(decide("confirmacao", 0.6, null, none)).toMatchObject({
      kind: "review",
    })
    expect(decide("reprovacao", 0.95, null, none)).toMatchObject({
      kind: "review",
      reason: "no_application",
    })
    expect(decide("recrutador_contato", 0.95, null, none)).toEqual({
      kind: "skip",
      reason: "no_application",
    })
  })

  it("skips alerts, verification codes and irrelevant mail", () => {
    expect(decide("vaga_alerta", 0.99, "enviada")).toEqual({
      kind: "skip",
      reason: "job_alert",
    })
    expect(decide("codigo_verificacao", 0.99, "enviada")).toEqual({
      kind: "skip",
      reason: "verification_code",
    })
    expect(decide("irrelevante", 0.99, "enviada")).toEqual({
      kind: "skip",
      reason: "irrelevant",
    })
  })

  it("writes deadlines only for confident apply/link outcomes", () => {
    expect(
      shouldWriteNextAction({ kind: "link", applicationId: "x" }, 0.9)
    ).toBe(true)
    expect(
      shouldWriteNextAction({ kind: "link", applicationId: "x" }, 0.7)
    ).toBe(false)
    expect(
      shouldWriteNextAction(
        {
          kind: "review",
          applicationId: "x",
          suggestedStatus: null,
          reason: "needs_review",
        },
        0.99
      )
    ).toBe(false)
  })
})
