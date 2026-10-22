/**
 * Tracker domain (F10, F10A, J6): shared row shape, filters, totals, pending actions and
 * overview metrics. Used by the web table, kanban, exports and the agent. Pure: no I/O.
 */
import {
  DEFAULT_TIME_ZONE,
  monthKey,
  startOfZonedMonth,
  startOfZonedYear,
} from "./dates.js"
import {
  isResponseStatus,
  isSubmittedStatus,
  type ApplicationStatus,
} from "./status.js"

/** Spec 9.2 `job_source`. */
export const JOB_SOURCES = [
  "linkedin",
  "gupy",
  "inhire",
  "greenhouse",
  "lever",
  "workday",
  "successfactors",
  "quickin",
  "jobbol",
  "solides",
  "email",
  "indicacao",
  "outro",
] as const

export type JobSource = (typeof JOB_SOURCES)[number]

/** Spec 9.2 `application_route`. */
export const APPLICATION_ROUTES = [
  "extensao",
  "email",
  "manual",
  "autonomo",
] as const

export type ApplicationRoute = (typeof APPLICATION_ROUTES)[number]

/** Spec 9.2 `fit_level`. */
export const FIT_LEVELS = ["alto", "medio", "baixo"] as const

export type FitLevel = (typeof FIT_LEVELS)[number]

/** Spec 9.2 `contract_regime`. */
export const CONTRACT_REGIMES = ["clt", "pj", "ambos", "nao_informado"] as const

export type ContractRegime = (typeof CONTRACT_REGIMES)[number]

export function isJobSource(value: unknown): value is JobSource {
  return (
    typeof value === "string" &&
    (JOB_SOURCES as readonly string[]).includes(value)
  )
}

export function isApplicationRoute(value: unknown): value is ApplicationRoute {
  return (
    typeof value === "string" &&
    (APPLICATION_ROUTES as readonly string[]).includes(value)
  )
}

export function isFitLevel(value: unknown): value is FitLevel {
  return (
    typeof value === "string" &&
    (FIT_LEVELS as readonly string[]).includes(value)
  )
}

/** One application as the tracker shows it (applications + match + posting + CV). */
export interface TrackerApplication {
  id: string
  company: string
  roleTitle: string
  source: JobSource
  route: ApplicationRoute | null
  status: ApplicationStatus
  /** ISO-8601 instants (UTC). */
  appliedAt: string | null
  createdAt: string
  updatedAt: string
  nextAction: string | null
  nextActionDueAt: string | null
  link: string | null
  notes: string | null
  location: string | null
  regime: ContractRegime | null
  fit: FitLevel | null
  fitScore: number | null
  cvLabel: string | null
  cvTrack: string | null
  /** Display text of `salary_informed`. */
  salaryInformed: string | null
}

export const PERIOD_PRESETS = [
  "tudo",
  "mes_atual",
  "30d",
  "90d",
  "ano",
] as const

export type PeriodPreset = (typeof PERIOD_PRESETS)[number]

export const NO_FIT = "sem_fit" as const

export type FitFilter = FitLevel | typeof NO_FIT

export interface TrackerFilters {
  q?: string
  status?: readonly ApplicationStatus[]
  source?: readonly JobSource[]
  route?: readonly ApplicationRoute[]
  fit?: readonly FitFilter[]
  period?: PeriodPreset
}

export function isPeriodPreset(value: unknown): value is PeriodPreset {
  return (
    typeof value === "string" &&
    (PERIOD_PRESETS as readonly string[]).includes(value)
  )
}

/** The date a row is filed under: when it was sent, or when it was created. */
export function referenceDate(row: TrackerApplication): Date {
  return new Date(row.appliedAt ?? row.createdAt)
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Inclusive start of a period preset, or null for "tudo". */
export function periodStart(
  period: PeriodPreset,
  now: Date,
  timeZone = DEFAULT_TIME_ZONE
): Date | null {
  switch (period) {
    case "tudo":
      return null
    case "mes_atual":
      return startOfZonedMonth(now, timeZone)
    case "30d":
      return new Date(now.getTime() - 30 * DAY_MS)
    case "90d":
      return new Date(now.getTime() - 90 * DAY_MS)
    case "ano":
      return startOfZonedYear(now, timeZone)
    default: {
      const unreachable: never = period
      throw new Error(`Unknown period: ${String(unreachable)}`)
    }
  }
}

/** Lowercase without accents, for search. */
export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim()
}

function matchesSearch(row: TrackerApplication, query: string): boolean {
  const haystack = normalizeSearchText(
    [row.company, row.roleTitle, row.location, row.notes, row.nextAction]
      .filter(Boolean)
      .join(" ")
  )
  return normalizeSearchText(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term))
}

export function hasActiveFilters(filters: TrackerFilters): boolean {
  return Boolean(
    filters.q?.trim() ||
    filters.status?.length ||
    filters.source?.length ||
    filters.route?.length ||
    filters.fit?.length ||
    (filters.period && filters.period !== "tudo")
  )
}

/** Applies the table filters (P3.1: status, fonte, rota, período, fit, busca). */
export function filterApplications(
  rows: readonly TrackerApplication[],
  filters: TrackerFilters,
  now: Date,
  timeZone = DEFAULT_TIME_ZONE
): TrackerApplication[] {
  const start = periodStart(filters.period ?? "tudo", now, timeZone)
  return rows.filter((row) => {
    if (filters.status?.length && !filters.status.includes(row.status))
      return false
    if (filters.source?.length && !filters.source.includes(row.source))
      return false
    if (
      filters.route?.length &&
      (!row.route || !filters.route.includes(row.route))
    ) {
      return false
    }
    if (filters.fit?.length && !filters.fit.includes(row.fit ?? NO_FIT))
      return false
    if (start && referenceDate(row).getTime() < start.getTime()) return false
    if (filters.q?.trim() && !matchesSearch(row, filters.q)) return false
    return true
  })
}

export interface PendingAction {
  applicationId: string
  company: string
  roleTitle: string
  status: ApplicationStatus
  action: string
  dueAt: string | null
}

/** "Suas ações": every next action, earliest deadline first, undated last (J5 step 4). */
export function pendingActions(
  rows: readonly TrackerApplication[]
): PendingAction[] {
  return rows
    .filter((row): row is TrackerApplication & { nextAction: string } =>
      Boolean(row.nextAction?.trim())
    )
    .map((row) => ({
      applicationId: row.id,
      company: row.company,
      roleTitle: row.roleTitle,
      status: row.status,
      action: row.nextAction,
      dueAt: row.nextActionDueAt,
    }))
    .sort((a, b) => {
      if (a.dueAt && b.dueAt) return a.dueAt.localeCompare(b.dueAt)
      if (a.dueAt) return -1
      if (b.dueAt) return 1
      return a.company.localeCompare(b.company, "pt-BR")
    })
}

export type DueUrgency = "overdue" | "soon" | "scheduled" | "undated"

/** Overdue, due within 48 h, later, or without a date. */
export function dueUrgency(dueAt: string | null, now: Date): DueUrgency {
  if (!dueAt) return "undated"
  const diff = new Date(dueAt).getTime() - now.getTime()
  if (diff < 0) return "overdue"
  if (diff <= 2 * DAY_MS) return "soon"
  return "scheduled"
}

export interface TrackerSummary {
  total: number
  byStatus: Record<ApplicationStatus, number>
  bySource: Partial<Record<JobSource, number>>
  /** Keyed by CV track name; rows without CV land under `null` as `withoutTrack`. */
  byTrack: { track: string; count: number }[]
  withoutTrack: number
  submitted: number
  responses: number
  /** responses / submitted, 0–1, or null when nothing was sent. */
  responseRate: number | null
}

/** Totals for the PDF cover (F10A RF10A.2) and the J6 summary. */
export function summarizeApplications(
  rows: readonly TrackerApplication[]
): TrackerSummary {
  const byStatus = {
    rascunho: 0,
    descartada: 0,
    em_andamento: 0,
    enviada: 0,
    em_analise: 0,
    etapa_pendente: 0,
    entrevista: 0,
    proposta: 0,
    reprovada: 0,
    encerrada: 0,
  } satisfies Record<ApplicationStatus, number>
  const bySource: Partial<Record<JobSource, number>> = {}
  const tracks = new Map<string, number>()
  let withoutTrack = 0
  let submitted = 0
  let responses = 0

  for (const row of rows) {
    byStatus[row.status] += 1
    bySource[row.source] = (bySource[row.source] ?? 0) + 1
    if (row.cvTrack) tracks.set(row.cvTrack, (tracks.get(row.cvTrack) ?? 0) + 1)
    else withoutTrack += 1
    if (isSubmittedStatus(row.status)) submitted += 1
    if (isResponseStatus(row.status)) responses += 1
  }

  return {
    total: rows.length,
    byStatus,
    bySource,
    byTrack: [...tracks.entries()]
      .map(([track, count]) => ({ track, count }))
      .sort(
        (a, b) => b.count - a.count || a.track.localeCompare(b.track, "pt-BR")
      ),
    withoutTrack,
    submitted,
    responses,
    responseRate: submitted === 0 ? null : responses / submitted,
  }
}

export interface OverviewMetrics {
  /** Rows filed in the current month (user time zone). */
  thisMonth: number
  lastMonth: number
  /** Count per week for the last 8 weeks, oldest first. */
  weekly: number[]
  averageFit: number | null
  fitSamples: number
  pending: number
  overdue: number
  dueSoon: number
  responseRate: number | null
  submitted: number
}

/** Metric cards of the overview (plan: candidaturas do mês, fit médio, ações, taxa de retorno). */
export function overviewMetrics(
  rows: readonly TrackerApplication[],
  now: Date,
  timeZone = DEFAULT_TIME_ZONE
): OverviewMetrics {
  const currentMonth = monthKey(now, timeZone)
  const previous = new Date(startOfZonedMonth(now, timeZone).getTime() - DAY_MS)
  const previousMonth = monthKey(previous, timeZone)
  const weekly = Array.from({ length: 8 }, () => 0)
  let thisMonth = 0
  let lastMonth = 0
  let fitTotal = 0
  let fitSamples = 0
  let pending = 0
  let overdue = 0
  let dueSoon = 0

  for (const row of rows) {
    const filed = referenceDate(row)
    const key = monthKey(filed, timeZone)
    if (key === currentMonth) thisMonth += 1
    else if (key === previousMonth) lastMonth += 1
    const weeksAgo = Math.floor(
      (now.getTime() - filed.getTime()) / (7 * DAY_MS)
    )
    if (weeksAgo >= 0 && weeksAgo < weekly.length) {
      weekly[weekly.length - 1 - weeksAgo] =
        (weekly[weekly.length - 1 - weeksAgo] ?? 0) + 1
    }
    if (typeof row.fitScore === "number") {
      fitTotal += row.fitScore
      fitSamples += 1
    }
    if (row.nextAction?.trim()) {
      pending += 1
      const urgency = dueUrgency(row.nextActionDueAt, now)
      if (urgency === "overdue") overdue += 1
      if (urgency === "soon") dueSoon += 1
    }
  }

  const summary = summarizeApplications(rows)
  return {
    thisMonth,
    lastMonth,
    weekly,
    averageFit: fitSamples === 0 ? null : Math.round(fitTotal / fitSamples),
    fitSamples,
    pending,
    overdue,
    dueSoon,
    responseRate: summary.responseRate,
    submitted: summary.submitted,
  }
}
