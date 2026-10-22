import { describe, expect, it } from "vitest"

import {
  allowedTransitions,
  APPLICATION_STATUSES,
  AUTO_APPLY_MIN_CONFIDENCE,
  canTransition,
  checkTransition,
  EVENT_SOURCES,
  isApplicationStatus,
  isAutomaticSource,
  isEventSource,
  isResponseStatus,
  isSubmittedStatus,
  isTerminalStatus,
  statusRank,
  TERMINAL_STATUSES,
  type ApplicationStatus,
  type EventSource,
  type TransitionContext,
} from "./status.js"

/** Spec 9.4, literal. */
const SPEC_EDGES: Record<ApplicationStatus, ApplicationStatus[]> = {
  rascunho: ["em_andamento", "descartada", "enviada"],
  em_andamento: ["enviada", "descartada", "rascunho"],
  enviada: [
    "em_analise",
    "etapa_pendente",
    "entrevista",
    "reprovada",
    "encerrada",
  ],
  em_analise: ["etapa_pendente", "entrevista", "reprovada", "encerrada"],
  etapa_pendente: ["em_analise", "entrevista", "reprovada", "encerrada"],
  entrevista: [
    "etapa_pendente",
    "entrevista",
    "proposta",
    "reprovada",
    "encerrada",
  ],
  proposta: ["encerrada"],
  reprovada: [],
  encerrada: [],
  descartada: [],
}

const REOPEN_EDGES: Record<ApplicationStatus, ApplicationStatus[]> = {
  rascunho: [],
  em_andamento: [],
  enviada: [],
  em_analise: [],
  etapa_pendente: [],
  entrevista: [],
  proposta: [],
  reprovada: ["enviada", "em_analise", "etapa_pendente", "entrevista"],
  encerrada: ["enviada", "em_analise", "etapa_pendente", "entrevista"],
  descartada: ["rascunho"],
}

const AUTOMATIC_SOURCES = EVENT_SOURCES.filter((source) => source !== "usuario")

const manual: TransitionContext = { source: "usuario" }

function automatic(
  source: EventSource = "gmail",
  overrides: Partial<TransitionContext> = {}
): TransitionContext {
  return { source, confidence: 0.95, hasEvidence: true, ...overrides }
}

const pairs = APPLICATION_STATUSES.flatMap((from) =>
  APPLICATION_STATUSES.map((to) => [from, to] as const)
)

describe("status enums", () => {
  it("has the 10 statuses and 6 sources of spec 9.2", () => {
    expect(APPLICATION_STATUSES).toHaveLength(10)
    expect(EVENT_SOURCES).toHaveLength(6)
    expect(isApplicationStatus("enviada")).toBe(true)
    expect(isApplicationStatus("aprovada")).toBe(false)
    expect(isApplicationStatus(3)).toBe(false)
    expect(isEventSource("gmail")).toBe(true)
    expect(isEventSource("email")).toBe(false)
  })

  it("only usuario is a manual source", () => {
    expect(isAutomaticSource("usuario")).toBe(false)
    for (const source of AUTOMATIC_SOURCES) {
      expect(isAutomaticSource(source)).toBe(true)
    }
  })

  it("reprovada, encerrada and descartada are terminal", () => {
    expect([...TERMINAL_STATUSES].sort()).toEqual(
      ["descartada", "encerrada", "reprovada"].sort()
    )
    for (const status of APPLICATION_STATUSES) {
      expect(isTerminalStatus(status)).toBe(
        (TERMINAL_STATUSES as readonly string[]).includes(status)
      )
    }
  })

  it("ranks progress monotonically with terminals last", () => {
    expect(statusRank("rascunho")).toBeLessThan(statusRank("enviada"))
    expect(statusRank("enviada")).toBeLessThan(statusRank("em_analise"))
    expect(statusRank("em_analise")).toBeLessThan(statusRank("etapa_pendente"))
    expect(statusRank("etapa_pendente")).toBeLessThan(statusRank("entrevista"))
    expect(statusRank("entrevista")).toBeLessThan(statusRank("proposta"))
    for (const terminal of TERMINAL_STATUSES) {
      expect(statusRank(terminal)).toBeGreaterThan(statusRank("proposta"))
    }
  })

  it("classifies response and submitted statuses for metrics", () => {
    expect(APPLICATION_STATUSES.filter(isResponseStatus)).toEqual([
      "em_analise",
      "etapa_pendente",
      "entrevista",
      "proposta",
      "reprovada",
    ])
    expect(APPLICATION_STATUSES.filter(isSubmittedStatus)).toEqual([
      "enviada",
      "em_analise",
      "etapa_pendente",
      "entrevista",
      "proposta",
      "reprovada",
      "encerrada",
    ])
  })
})

describe("manual transitions (source usuario)", () => {
  it.each(pairs)(
    "%s → %s follows spec 9.4 plus manual reopening",
    (from, to) => {
      const expected =
        SPEC_EDGES[from].includes(to) || REOPEN_EDGES[from].includes(to)
      const result = checkTransition(from, to, manual)
      expect(result.ok).toBe(expected)
      expect(result.mode).toBe("manual")
      if (result.ok) {
        expect(result.reopen).toBe(REOPEN_EDGES[from].includes(to))
      } else {
        expect(result.reason).toBe(from === to ? "same_status" : "not_allowed")
      }
    }
  )

  it("accepts exactly the spec edges from every status", () => {
    for (const from of APPLICATION_STATUSES) {
      const expected = APPLICATION_STATUSES.filter(
        (to) => SPEC_EDGES[from].includes(to) || REOPEN_EDGES[from].includes(to)
      )
      expect(allowedTransitions(from, manual)).toEqual(expected)
    }
  })

  it("reprovada is terminal and reopens only manually", () => {
    expect(canTransition("reprovada", "em_analise", manual)).toBe(true)
    for (const source of AUTOMATIC_SOURCES) {
      expect(canTransition("reprovada", "em_analise", automatic(source))).toBe(
        false
      )
    }
  })

  it("does not require confidence or evidence", () => {
    expect(
      canTransition("enviada", "reprovada", {
        source: "usuario",
        confidence: 0.1,
      })
    ).toBe(true)
  })

  it("confirmedByUser applies manual rules but keeps the automatic source", () => {
    const confirmed: TransitionContext = {
      source: "gmail",
      confirmedByUser: true,
      confidence: 0.4,
    }
    const result = checkTransition("etapa_pendente", "em_analise", confirmed)
    expect(result).toEqual({ ok: true, mode: "manual", reopen: false })
    expect(canTransition("reprovada", "entrevista", confirmed)).toBe(true)
  })
})

describe("automatic transitions (gmail, agente, extensao, worker, sistema)", () => {
  it.each(
    AUTOMATIC_SOURCES.flatMap((source) =>
      pairs.map(([from, to]) => [source, from, to] as const)
    )
  )(
    "%s: %s → %s never leaves a terminal state and never regresses",
    (source, from, to) => {
      const result = checkTransition(from, to, automatic(source))
      const expected =
        !isTerminalStatus(from) &&
        SPEC_EDGES[from].includes(to) &&
        statusRank(to) >= statusRank(from)
      expect(result.ok).toBe(expected)
      expect(result.mode).toBe("automatic")
      if (!result.ok) {
        if (isTerminalStatus(from) && from !== to) {
          expect(result.reason).toBe("terminal_requires_user")
        }
        if (!isTerminalStatus(from) && SPEC_EDGES[from].includes(to)) {
          expect(result.reason).toBe("regression")
        }
      }
    }
  )

  it("never leaves reprovada, encerrada or descartada", () => {
    for (const from of TERMINAL_STATUSES) {
      for (const source of AUTOMATIC_SOURCES) {
        expect(allowedTransitions(from, automatic(source))).toEqual([])
      }
    }
  })

  it("rejects the spec edges that go backwards", () => {
    expect(
      checkTransition("em_andamento", "rascunho", automatic())
    ).toMatchObject({
      ok: false,
      reason: "regression",
    })
    expect(
      checkTransition("etapa_pendente", "em_analise", automatic())
    ).toMatchObject({
      ok: false,
      reason: "regression",
    })
    expect(
      checkTransition("entrevista", "etapa_pendente", automatic())
    ).toMatchObject({
      ok: false,
      reason: "regression",
    })
  })

  it("applies forward Gmail updates with evidence and confidence ≥ 0,8", () => {
    expect(checkTransition("rascunho", "enviada", automatic())).toEqual({
      ok: true,
      mode: "automatic",
      reopen: false,
    })
    expect(canTransition("enviada", "reprovada", automatic())).toBe(true)
    expect(canTransition("em_analise", "etapa_pendente", automatic())).toBe(
      true
    )
    expect(canTransition("entrevista", "entrevista", automatic())).toBe(true)
    expect(
      canTransition(
        "enviada",
        "em_analise",
        automatic("gmail", { confidence: AUTO_APPLY_MIN_CONFIDENCE })
      )
    ).toBe(true)
  })

  it("sends low confidence to the Revise queue", () => {
    for (const confidence of [0.79, 0, null, undefined, Number.NaN]) {
      expect(
        checkTransition(
          "enviada",
          "em_analise",
          automatic("gmail", { confidence })
        )
      ).toEqual({ ok: false, mode: "automatic", reason: "needs_review" })
    }
  })

  it("CA10.2 requires evidence for automatic changes", () => {
    expect(
      checkTransition(
        "enviada",
        "em_analise",
        automatic("gmail", { hasEvidence: false })
      )
    ).toEqual({ ok: false, mode: "automatic", reason: "missing_evidence" })
  })

  it("rejects transitions outside the graph", () => {
    expect(checkTransition("rascunho", "entrevista", automatic())).toEqual({
      ok: false,
      mode: "automatic",
      reason: "not_allowed",
    })
    expect(checkTransition("proposta", "reprovada", automatic())).toMatchObject(
      {
        ok: false,
        reason: "not_allowed",
      }
    )
  })

  it("rejects no-op changes", () => {
    expect(checkTransition("enviada", "enviada", automatic())).toMatchObject({
      ok: false,
      reason: "same_status",
    })
    expect(checkTransition("enviada", "enviada", manual)).toMatchObject({
      ok: false,
      reason: "same_status",
    })
  })
})
