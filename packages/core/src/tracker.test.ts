import { describe, expect, it } from "vitest"

import {
  dueUrgency,
  filterApplications,
  hasActiveFilters,
  normalizeSearchText,
  overviewMetrics,
  pendingActions,
  periodStart,
  summarizeApplications,
  type TrackerApplication,
} from "./tracker.js"

const NOW = new Date("2026-10-21T15:00:00.000Z")

let sequence = 0
function row(overrides: Partial<TrackerApplication> = {}): TrackerApplication {
  sequence += 1
  return {
    id: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    company: "Empresa Fictícia",
    roleTitle: "Analista",
    source: "gupy",
    route: "manual",
    status: "enviada",
    appliedAt: "2026-10-10T12:00:00.000Z",
    createdAt: "2026-10-09T12:00:00.000Z",
    updatedAt: "2026-10-10T12:00:00.000Z",
    nextAction: null,
    nextActionDueAt: null,
    link: null,
    notes: null,
    location: null,
    regime: null,
    fit: null,
    fitScore: null,
    cvLabel: null,
    cvTrack: null,
    salaryInformed: null,
    ...overrides,
  }
}

describe("filterApplications (P3.1 filtros)", () => {
  const rows = [
    row({
      company: "Açaí Tech",
      status: "entrevista",
      source: "linkedin",
      fit: "alto",
    }),
    row({
      company: "Beta",
      status: "rascunho",
      source: "gupy",
      route: "extensao",
      fit: "medio",
    }),
    row({ company: "Gama", status: "reprovada", source: "lever", route: null }),
    row({
      company: "Delta",
      status: "enviada",
      appliedAt: "2026-06-01T12:00:00.000Z",
      notes: "Indicação da Joana",
    }),
  ]

  it("filters by status, source, route and fit", () => {
    expect(
      filterApplications(rows, { status: ["entrevista", "rascunho"] }, NOW)
    ).toHaveLength(2)
    expect(
      filterApplications(rows, { source: ["lever"] }, NOW).map((r) => r.company)
    ).toEqual(["Gama"])
    expect(
      filterApplications(rows, { route: ["extensao"] }, NOW).map(
        (r) => r.company
      )
    ).toEqual(["Beta"])
    expect(filterApplications(rows, { fit: ["sem_fit"] }, NOW)).toHaveLength(2)
    expect(
      filterApplications(rows, { fit: ["alto", "medio"] }, NOW)
    ).toHaveLength(2)
  })

  it("filters by period using the send date, then the creation date", () => {
    expect(filterApplications(rows, { period: "mes_atual" }, NOW)).toHaveLength(
      3
    )
    expect(filterApplications(rows, { period: "ano" }, NOW)).toHaveLength(4)
    expect(filterApplications(rows, { period: "30d" }, NOW)).toHaveLength(3)
    expect(filterApplications(rows, { period: "tudo" }, NOW)).toHaveLength(4)
  })

  it("searches without accents across company, role and notes", () => {
    expect(
      filterApplications(rows, { q: "acai" }, NOW).map((r) => r.company)
    ).toEqual(["Açaí Tech"])
    expect(
      filterApplications(rows, { q: "joana" }, NOW).map((r) => r.company)
    ).toEqual(["Delta"])
    expect(filterApplications(rows, { q: "  " }, NOW)).toHaveLength(4)
  })

  it("combines filters with AND", () => {
    expect(
      filterApplications(
        rows,
        { status: ["enviada"], period: "mes_atual" },
        NOW
      )
    ).toHaveLength(0)
  })

  it("tells when filters are active", () => {
    expect(hasActiveFilters({})).toBe(false)
    expect(hasActiveFilters({ period: "tudo", q: " " })).toBe(false)
    expect(hasActiveFilters({ period: "mes_atual" })).toBe(true)
    expect(hasActiveFilters({ status: ["enviada"] })).toBe(true)
  })

  it("starts the month in the user's time zone", () => {
    expect(periodStart("mes_atual", NOW)?.toISOString()).toBe(
      "2026-10-01T03:00:00.000Z"
    )
    expect(periodStart("tudo", NOW)).toBeNull()
  })

  it("normalizes search text", () => {
    expect(normalizeSearchText("  Próxima AÇÃO ")).toBe("proxima acao")
  })
})

describe("pendingActions (Suas ações)", () => {
  it("orders by deadline and puts undated actions last", () => {
    const actions = pendingActions([
      row({ company: "Sem prazo", nextAction: "Ligar" }),
      row({
        company: "Depois",
        nextAction: "Teste",
        nextActionDueAt: "2026-10-30T12:00:00Z",
      }),
      row({
        company: "Antes",
        nextAction: "Entrevista",
        nextActionDueAt: "2026-10-22T12:00:00Z",
      }),
      row({ company: "Nada", nextAction: "  " }),
    ])
    expect(actions.map((action) => action.company)).toEqual([
      "Antes",
      "Depois",
      "Sem prazo",
    ])
  })

  it("classifies urgency", () => {
    expect(dueUrgency(null, NOW)).toBe("undated")
    expect(dueUrgency("2026-10-21T14:00:00Z", NOW)).toBe("overdue")
    expect(dueUrgency("2026-10-22T14:00:00Z", NOW)).toBe("soon")
    expect(dueUrgency("2026-10-30T14:00:00Z", NOW)).toBe("scheduled")
  })
})

describe("summaries and metrics", () => {
  const rows = [
    row({
      status: "enviada",
      source: "gupy",
      cvTrack: "Executivo",
      fitScore: 90,
    }),
    row({
      status: "em_analise",
      source: "gupy",
      cvTrack: "Executivo",
      fitScore: 80,
    }),
    row({ status: "reprovada", source: "linkedin", cvTrack: "Dados" }),
    row({
      status: "rascunho",
      source: "email",
      appliedAt: null,
      createdAt: "2026-09-15T12:00:00Z",
      nextAction: "Revisar CV",
      nextActionDueAt: "2026-10-21T10:00:00Z",
    }),
    row({
      status: "entrevista",
      nextAction: "Entrevista",
      nextActionDueAt: "2026-10-22T13:00:00Z",
    }),
  ]

  it("totals by status, source and CV track with the response rate", () => {
    const summary = summarizeApplications(rows)
    expect(summary.total).toBe(5)
    expect(summary.byStatus.enviada).toBe(1)
    expect(summary.byStatus.rascunho).toBe(1)
    expect(summary.bySource).toEqual({ gupy: 3, linkedin: 1, email: 1 })
    expect(summary.byTrack).toEqual([
      { track: "Executivo", count: 2 },
      { track: "Dados", count: 1 },
    ])
    expect(summary.withoutTrack).toBe(2)
    expect(summary.submitted).toBe(4)
    expect(summary.responses).toBe(3)
    expect(summary.responseRate).toBeCloseTo(0.75)
    expect(summarizeApplications([]).responseRate).toBeNull()
  })

  it("computes the overview cards", () => {
    const metrics = overviewMetrics(rows, NOW)
    expect(metrics.thisMonth).toBe(4)
    expect(metrics.lastMonth).toBe(1)
    expect(metrics.weekly).toHaveLength(8)
    expect(metrics.weekly.reduce((sum, value) => sum + value, 0)).toBe(5)
    expect(metrics.averageFit).toBe(85)
    expect(metrics.fitSamples).toBe(2)
    expect(metrics.pending).toBe(2)
    expect(metrics.overdue).toBe(1)
    expect(metrics.dueSoon).toBe(1)
    expect(metrics.responseRate).toBeCloseTo(0.75)
  })
})
