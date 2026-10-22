/**
 * Tracker spreadsheet (F10 RF10.5/RF10.6, F10A RF10A.1): CSV export columns and CSV import with
 * column mapping and rejected-row report (CA10.1, CA10.3). Labels come from the caller (i18n).
 */
import { parseCsv, toCsv } from "./csv.js"
import {
  DEFAULT_TIME_ZONE,
  formatDateBR,
  formatDateTimeBR,
  parseUserDate,
} from "./dates.js"
import {
  APPLICATION_STATUSES,
  isApplicationStatus,
  type ApplicationStatus,
} from "./status.js"
import {
  APPLICATION_ROUTES,
  JOB_SOURCES,
  normalizeSearchText,
  referenceDate,
  type ApplicationRoute,
  type ContractRegime,
  type JobSource,
  type TrackerApplication,
} from "./tracker.js"

/** RF10A.1 column order. */
export const EXPORT_COLUMNS = [
  "date",
  "company",
  "role",
  "source",
  "route",
  "link",
  "cv",
  "salary",
  "regime",
  "status",
  "nextAction",
  "dueAt",
  "notes",
] as const

export type ExportColumn = (typeof EXPORT_COLUMNS)[number]

export interface TrackerCsvLabels {
  headers: Record<ExportColumn, string>
  status: Record<ApplicationStatus, string>
  source: Record<JobSource, string>
  route: Record<ApplicationRoute, string>
  regime: Record<ContractRegime, string>
}

function exportCell(
  row: TrackerApplication,
  column: ExportColumn,
  labels: TrackerCsvLabels,
  timeZone: string
): string {
  switch (column) {
    case "date":
      return formatDateBR(referenceDate(row), timeZone)
    case "company":
      return row.company
    case "role":
      return row.roleTitle
    case "source":
      return labels.source[row.source]
    case "route":
      return row.route ? labels.route[row.route] : ""
    case "link":
      return row.link ?? ""
    case "cv":
      return row.cvLabel ?? ""
    case "salary":
      return row.salaryInformed ?? ""
    case "regime":
      return row.regime ? labels.regime[row.regime] : ""
    case "status":
      return labels.status[row.status]
    case "nextAction":
      return row.nextAction ?? ""
    case "dueAt":
      return row.nextActionDueAt
        ? formatDateTimeBR(new Date(row.nextActionDueAt), timeZone)
        : ""
    case "notes":
      return row.notes ?? ""
    default: {
      const unreachable: never = column
      throw new Error(`Unknown column: ${String(unreachable)}`)
    }
  }
}

/** UTF-8 with BOM, `;`, CRLF, dates dd/mm/aaaa (CA10.1). */
export function buildTrackerCsv(
  rows: readonly TrackerApplication[],
  labels: TrackerCsvLabels,
  timeZone = DEFAULT_TIME_ZONE
): string {
  const header = EXPORT_COLUMNS.map((column) => labels.headers[column])
  const body = rows.map((row) =>
    EXPORT_COLUMNS.map((column) => exportCell(row, column, labels, timeZone))
  )
  return toCsv([header, ...body], { delimiter: ";", bom: true })
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export const IMPORT_FIELDS = [
  "company",
  "roleTitle",
  "source",
  "route",
  "status",
  "appliedAt",
  "link",
  "salaryInformed",
  "nextAction",
  "nextActionDueAt",
  "notes",
] as const

export type ImportField = (typeof IMPORT_FIELDS)[number]

export const REQUIRED_IMPORT_FIELDS = [
  "company",
  "roleTitle",
] as const satisfies readonly ImportField[]

/** Field → zero-based column index in the file, or null when not mapped. */
export type ImportMapping = Record<ImportField, number | null>

export const MAX_IMPORT_ROWS = 2000

export const IMPORT_LIMITS = {
  company: 200,
  roleTitle: 200,
  link: 2000,
  salaryInformed: 200,
  nextAction: 300,
  notes: 5000,
} as const

const HEADER_SYNONYMS: Record<ImportField, readonly string[]> = {
  company: ["empresa", "company", "companhia", "organizacao"],
  roleTitle: ["cargo", "vaga", "titulo", "posicao", "role", "title", "job"],
  source: ["fonte", "origem", "plataforma", "source", "site"],
  route: ["rota", "canal", "route", "via"],
  status: ["status", "situacao", "etapa", "fase"],
  appliedAt: [
    "data",
    "data de envio",
    "enviada em",
    "data da candidatura",
    "applied",
    "date",
  ],
  link: ["link", "url", "endereco"],
  salaryInformed: ["pretensao", "pretensao informada", "salario", "salary"],
  nextAction: [
    "proxima acao",
    "acao",
    "proximo passo",
    "next action",
    "tarefa",
  ],
  nextActionDueAt: ["prazo", "vencimento", "due", "deadline", "data limite"],
  notes: ["notas", "observacoes", "obs", "comentarios", "notes"],
}

/** Guesses the mapping from header names (accent and case insensitive). Each column used once. */
export function guessImportMapping(headers: readonly string[]): ImportMapping {
  const normalized = headers.map((header) => normalizeSearchText(header))
  const used = new Set<number>()
  const mapping = Object.fromEntries(
    IMPORT_FIELDS.map((field) => [field, null])
  ) as ImportMapping

  for (const exact of [true, false]) {
    for (const field of IMPORT_FIELDS) {
      if (mapping[field] !== null) continue
      const index = normalized.findIndex(
        (header, position) =>
          !used.has(position) &&
          HEADER_SYNONYMS[field].some((synonym) =>
            exact ? header === synonym : header.startsWith(synonym)
          )
      )
      if (index !== -1) {
        mapping[field] = index
        used.add(index)
      }
    }
  }
  return mapping
}

export type ImportRejection =
  | "missing_company"
  | "missing_role"
  | "invalid_status"
  | "invalid_source"
  | "invalid_route"
  | "invalid_date"
  | "invalid_due_date"
  | "invalid_link"
  | "too_long"

export interface ImportedApplication {
  company: string
  roleTitle: string
  source: JobSource
  route: ApplicationRoute
  status: ApplicationStatus
  appliedAt: string | null
  link: string | null
  salaryInformed: string | null
  nextAction: string | null
  nextActionDueAt: string | null
  notes: string | null
}

export interface ImportRowError {
  /** 1-based line in the file (header is line 1). */
  line: number
  reasons: ImportRejection[]
}

export interface ImportResult {
  valid: (ImportedApplication & { line: number })[]
  rejected: ImportRowError[]
  totalRows: number
  truncated: boolean
}

function keyed<T extends string>(
  values: readonly T[],
  labels: Partial<Record<T, string>>,
  extra: Partial<Record<string, T>> = {}
): Map<string, T> {
  const map = new Map<string, T>()
  for (const value of values) {
    map.set(normalizeSearchText(value), value)
    map.set(normalizeSearchText(value.replaceAll("_", " ")), value)
    const label = labels[value]
    if (label) map.set(normalizeSearchText(label), value)
  }
  for (const [alias, value] of Object.entries(extra)) {
    if (value) map.set(normalizeSearchText(alias), value)
  }
  return map
}

export interface ImportLabels {
  status: Partial<Record<ApplicationStatus, string>>
  source: Partial<Record<JobSource, string>>
  route: Partial<Record<ApplicationRoute, string>>
}

const STATUS_ALIASES: Partial<Record<string, ApplicationStatus>> = {
  pulada: "descartada",
  descartada: "descartada",
  "em preenchimento": "em_andamento",
  candidatada: "enviada",
  aplicada: "enviada",
  "em analise": "em_analise",
  teste: "etapa_pendente",
  "etapa pendente": "etapa_pendente",
  pendente: "etapa_pendente",
  oferta: "proposta",
  recusada: "reprovada",
  rejeitada: "reprovada",
  fechada: "encerrada",
  cancelada: "encerrada",
}

const SOURCE_ALIASES: Partial<Record<string, JobSource>> = {
  "e-mail": "email",
  indicacao: "indicacao",
  referral: "indicacao",
  "success factors": "successfactors",
  sap: "successfactors",
  outra: "outro",
  other: "outro",
}

const ROUTE_ALIASES: Partial<Record<string, ApplicationRoute>> = {
  "e-mail": "email",
  extensao: "extensao",
  extension: "extensao",
  site: "manual",
  autonoma: "autonomo",
}

function cell(row: readonly string[], index: number | null): string {
  if (index === null) return ""
  return (row[index] ?? "").trim()
}

function optional(value: string): string | null {
  return value === "" ? null : value
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}

/**
 * Validates and maps every data row. Header is the first row. Stops after MAX_IMPORT_ROWS
 * (`truncated`). Missing status becomes `enviada` when a send date exists, else `rascunho`.
 */
export function mapImportRows(
  text: string,
  mapping: ImportMapping,
  labels: ImportLabels,
  timeZone = DEFAULT_TIME_ZONE
): ImportResult {
  const [, ...data] = parseCsv(text)
  const statusKeys = keyed(APPLICATION_STATUSES, labels.status, STATUS_ALIASES)
  const sourceKeys = keyed(JOB_SOURCES, labels.source, SOURCE_ALIASES)
  const routeKeys = keyed(APPLICATION_ROUTES, labels.route, ROUTE_ALIASES)
  const rows = data.slice(0, MAX_IMPORT_ROWS)
  const result: ImportResult = {
    valid: [],
    rejected: [],
    totalRows: data.length,
    truncated: data.length > MAX_IMPORT_ROWS,
  }

  rows.forEach((row, index) => {
    const line = index + 2
    const reasons = new Set<ImportRejection>()
    const value = (field: ImportField) => cell(row, mapping[field])

    const company = value("company")
    const roleTitle = value("roleTitle")
    if (!company) reasons.add("missing_company")
    if (!roleTitle) reasons.add("missing_role")

    const rawSource = value("source")
    const source = rawSource
      ? sourceKeys.get(normalizeSearchText(rawSource))
      : "outro"
    if (!source) reasons.add("invalid_source")

    const rawRoute = value("route")
    const route = rawRoute
      ? routeKeys.get(normalizeSearchText(rawRoute))
      : "manual"
    if (!route) reasons.add("invalid_route")

    const rawApplied = value("appliedAt")
    const appliedAt = rawApplied ? parseUserDate(rawApplied, timeZone) : null
    if (rawApplied && !appliedAt) reasons.add("invalid_date")

    const rawDue = value("nextActionDueAt")
    const dueAt = rawDue ? parseUserDate(rawDue, timeZone) : null
    if (rawDue && !dueAt) reasons.add("invalid_due_date")

    const rawStatus = value("status")
    const status = rawStatus
      ? statusKeys.get(normalizeSearchText(rawStatus))
      : appliedAt
        ? "enviada"
        : "rascunho"
    if (!status || !isApplicationStatus(status)) reasons.add("invalid_status")

    const link = value("link")
    if (link && !isHttpUrl(link)) reasons.add("invalid_link")

    const lengths: [string, number][] = [
      [company, IMPORT_LIMITS.company],
      [roleTitle, IMPORT_LIMITS.roleTitle],
      [link, IMPORT_LIMITS.link],
      [value("salaryInformed"), IMPORT_LIMITS.salaryInformed],
      [value("nextAction"), IMPORT_LIMITS.nextAction],
      [value("notes"), IMPORT_LIMITS.notes],
    ]
    if (lengths.some(([text, limit]) => text.length > limit))
      reasons.add("too_long")

    if (reasons.size > 0 || !source || !route || !status) {
      result.rejected.push({ line, reasons: [...reasons] })
      return
    }

    result.valid.push({
      line,
      company,
      roleTitle,
      source,
      route,
      status,
      appliedAt: appliedAt?.toISOString() ?? null,
      link: optional(link),
      salaryInformed: optional(value("salaryInformed")),
      nextAction: optional(value("nextAction")),
      nextActionDueAt: dueAt?.toISOString() ?? null,
      notes: optional(value("notes")),
    })
  })

  return result
}
