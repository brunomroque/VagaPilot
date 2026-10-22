/**
 * Typed settings model shared by the chat tools and the forms (spec F14 RF14.1, RF4A.3, CA14.7).
 * Chat and form are two faces of the same model: both go through these schemas and
 * normalizers, so the same parameters always produce the same stored record.
 */

import { z } from "zod"

import { normalizeCompanyName } from "./blocklist.js"
import {
  FIT_LEVEL_VALUES,
  JOB_LANGUAGES,
  LANGUAGE_LEVEL_VALUES,
  SENIORITY_LEVELS,
  WORK_MODEL_VALUES,
} from "./job-rules.js"

export const SEARCH_FREQUENCIES = ["diaria", "dias_uteis", "semanal"] as const
export type SearchFrequency = (typeof SEARCH_FREQUENCIES)[number]

export const TIMES_OF_DAY = ["manha", "tarde", "noite"] as const
export type TimeOfDay = (typeof TIMES_OF_DAY)[number]

export const SEARCH_REGIMES = ["clt", "pj", "ambos"] as const

export const MAX_EXCLUDED_PER_SEARCH = 50

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

const nullableText = (max: number) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((value) => {
      const text = value ? collapse(value) : ""
      return text === "" ? null : text
    })

const nullableAmount = z
  .number()
  .nonnegative()
  .max(10_000_000)
  .nullish()
  .transform((value) => value ?? null)

/** Filters of a saved search: exactly the fields the spec lists (9.3 note, RF4A.3, 10.3). */
export const savedSearchSchema = z
  .object({
    query: z.string().max(120).transform(collapse).pipe(z.string().min(2)),
    seniority: z
      .enum(SENIORITY_LEVELS)
      .nullish()
      .transform((v) => v ?? null),
    location: nullableText(120),
    radiusKm: z
      .number()
      .int()
      .min(0)
      .max(500)
      .nullish()
      .transform((v) => v ?? null),
    workModel: z
      .enum(WORK_MODEL_VALUES)
      .nullish()
      .transform((v) => v ?? null),
    regime: z
      .enum(SEARCH_REGIMES)
      .nullish()
      .transform((v) => v ?? null),
    language: z
      .enum(JOB_LANGUAGES)
      .nullish()
      .transform((v) => v ?? null),
    salaryMin: nullableAmount,
    salaryMax: nullableAmount,
    postedWithinDays: z
      .number()
      .int()
      .min(1)
      .max(90)
      .nullish()
      .transform((v) => v ?? null),
    excludedCompanies: z
      .array(z.string().max(160))
      .max(MAX_EXCLUDED_PER_SEARCH)
      .nullish()
      .transform((list) => normalizeCompanyList(list ?? [])),
    frequency: z
      .enum(SEARCH_FREQUENCIES)
      .nullish()
      .transform((v) => v ?? "diaria"),
    timeOfDay: z
      .enum(TIMES_OF_DAY)
      .nullish()
      .transform((v) => v ?? null),
  })
  .refine(
    (value) =>
      value.salaryMin === null ||
      value.salaryMax === null ||
      value.salaryMin <= value.salaryMax,
    { message: "salaryMinAboveMax", path: ["salaryMin"] }
  )

export type SavedSearchInput = z.input<typeof savedSearchSchema>
export type SavedSearch = z.output<typeof savedSearchSchema>

/** Trimmed, deduplicated (by normalized name) and sorted company names. */
export function normalizeCompanyList(list: readonly string[]): string[] {
  const byKey = new Map<string, string>()
  for (const raw of list) {
    const name = collapse(raw)
    const key = normalizeCompanyName(name)
    if (!name || !key || byKey.has(key)) continue
    byKey.set(key, name)
  }
  return [...byKey.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "pt-BR"))
    .map(([, name]) => name)
}

export function normalizeSavedSearch(input: SavedSearchInput): SavedSearch {
  return savedSearchSchema.parse(input)
}

export type SavedSearchRow = {
  query: string
  seniority: string | null
  location: string | null
  radius_km: number | null
  work_model: string | null
  regime: string | null
  language: string | null
  salary_min: number | string | null
  salary_max: number | string | null
  posted_within_days: number | null
  excluded_companies: string[] | null
  frequency: string
  time_of_day: string | null
}

export function savedSearchToRow(search: SavedSearch): SavedSearchRow {
  return {
    query: search.query,
    seniority: search.seniority,
    location: search.location,
    radius_km: search.radiusKm,
    work_model: search.workModel,
    regime: search.regime,
    language: search.language,
    salary_min: search.salaryMin,
    salary_max: search.salaryMax,
    posted_within_days: search.postedWithinDays,
    excluded_companies: search.excludedCompanies,
    frequency: search.frequency,
    time_of_day: search.timeOfDay,
  }
}

function toNumber(value: number | string | null): number | null {
  if (value === null || value === "") return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

export function savedSearchFromRow(row: SavedSearchRow): SavedSearch {
  return normalizeSavedSearch({
    query: row.query,
    seniority: row.seniority as SavedSearchInput["seniority"],
    location: row.location,
    radiusKm: row.radius_km,
    workModel: row.work_model as SavedSearchInput["workModel"],
    regime: row.regime as SavedSearchInput["regime"],
    language: row.language as SavedSearchInput["language"],
    salaryMin: toNumber(row.salary_min),
    salaryMax: toNumber(row.salary_max),
    postedWithinDays: row.posted_within_days,
    excludedCompanies: row.excluded_companies ?? [],
    frequency: row.frequency as SavedSearchInput["frequency"],
    timeOfDay: row.time_of_day as SavedSearchInput["timeOfDay"],
  })
}

/** Partial update (`update_saved_search`): only the given fields change. */
export const savedSearchPatchSchema = z.object({
  query: z.string().max(120).optional(),
  seniority: z.enum(SENIORITY_LEVELS).nullable().optional(),
  location: z.string().max(120).nullable().optional(),
  radiusKm: z.number().int().min(0).max(500).nullable().optional(),
  workModel: z.enum(WORK_MODEL_VALUES).nullable().optional(),
  regime: z.enum(SEARCH_REGIMES).nullable().optional(),
  language: z.enum(JOB_LANGUAGES).nullable().optional(),
  salaryMin: z.number().nonnegative().nullable().optional(),
  salaryMax: z.number().nonnegative().nullable().optional(),
  postedWithinDays: z.number().int().min(1).max(90).nullable().optional(),
  excludedCompanies: z
    .array(z.string().max(160))
    .max(MAX_EXCLUDED_PER_SEARCH)
    .optional(),
  frequency: z.enum(SEARCH_FREQUENCIES).optional(),
  timeOfDay: z.enum(TIMES_OF_DAY).nullable().optional(),
})
export type SavedSearchPatch = z.infer<typeof savedSearchPatchSchema>

export function applySavedSearchPatch(
  current: SavedSearch,
  patch: SavedSearchPatch
): SavedSearch {
  const merged: SavedSearchInput = { ...current }
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) (merged as Record<string, unknown>)[key] = value
  }
  return normalizeSavedSearch(merged)
}

/** Local hour (America/Sao_Paulo) each slot runs at; no slot means 8 h. */
export const TIME_OF_DAY_HOUR: Record<TimeOfDay, number> = {
  manha: 8,
  tarde: 13,
  noite: 19,
}

function localParts(
  date: Date,
  timeZone: string
): { day: string; hour: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(date)
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? ""
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
  return {
    day: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
    weekday: weekdays.indexOf(get("weekday")),
  }
}

/**
 * Whether a saved search should run now (RF4A.3 "frequência configurável"): daily and
 * weekday searches run once per local day after their slot; weekly ones every 7 days.
 */
export function isSearchDue(
  search: Pick<SavedSearch, "frequency" | "timeOfDay">,
  lastRunAt: Date | null,
  now: Date,
  timeZone = "America/Sao_Paulo"
): boolean {
  const current = localParts(now, timeZone)
  const slot = TIME_OF_DAY_HOUR[search.timeOfDay ?? "manha"]
  if (current.hour < slot) return false
  switch (search.frequency) {
    case "semanal":
      return (
        !lastRunAt ||
        now.getTime() - lastRunAt.getTime() >=
          7 * 24 * 60 * 60 * 1000 - 60 * 60 * 1000
      )
    case "dias_uteis":
      if (current.weekday === 0 || current.weekday === 6) return false
      return !lastRunAt || localParts(lastRunAt, timeZone).day !== current.day
    case "diaria":
      return !lastRunAt || localParts(lastRunAt, timeZone).day !== current.day
    default: {
      const unreachable: never = search.frequency
      throw new Error(`Unknown frequency: ${String(unreachable)}`)
    }
  }
}

// ---------------------------------------------------------------------------
// Preferences (set_preference: enum keys only) and approval mode
// ---------------------------------------------------------------------------

export const PREFERENCE_KEYS = [
  "email.include_salary",
  "searches.min_fit",
] as const
export type PreferenceKey = (typeof PREFERENCE_KEYS)[number]

export const preferenceValueSchemas = {
  "email.include_salary": z.boolean(),
  "searches.min_fit": z.enum(FIT_LEVEL_VALUES),
} as const satisfies Record<PreferenceKey, z.ZodType>

export type PreferenceValue<K extends PreferenceKey> = z.infer<
  (typeof preferenceValueSchemas)[K]
>
export type Preferences = { [K in PreferenceKey]: PreferenceValue<K> }

/** "Não cite pretensão em e-mail" flips `email.include_salary` (F14 table). */
export const PREFERENCE_DEFAULTS: Preferences = {
  "email.include_salary": true,
  "searches.min_fit": "baixo",
}

export function isPreferenceKey(value: unknown): value is PreferenceKey {
  return (
    typeof value === "string" &&
    (PREFERENCE_KEYS as readonly string[]).includes(value)
  )
}

export function parsePreferenceValue(
  key: PreferenceKey,
  value: unknown
): { ok: true; value: PreferenceValue<PreferenceKey> } | { ok: false } {
  const parsed = preferenceValueSchemas[key].safeParse(value)
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false }
}

export const APPROVAL_MODES = ["pausar_antes", "envie_direto"] as const
export type ApprovalMode = (typeof APPROVAL_MODES)[number]
export const DEFAULT_APPROVAL_MODE: ApprovalMode = "pausar_antes"

export const ACCEPTED_SALARY_REGIMES = ["clt", "pj"] as const
export const SALARY_CURRENCIES = ["BRL", "USD", "EUR"] as const
export const SALARY_PERIODS_VALUES = ["mensal", "anual", "hora"] as const

export const salaryRulesInputSchema = z.object({
  rules: z
    .array(
      z
        .object({
          seniority: z.enum(SENIORITY_LEVELS),
          regime: z.enum(ACCEPTED_SALARY_REGIMES).default("clt"),
          amount: z.number().positive().max(10_000_000),
          min: z
            .number()
            .positive()
            .max(10_000_000)
            .nullish()
            .transform((v) => v ?? null),
          currency: z.enum(SALARY_CURRENCIES).default("BRL"),
          period: z.enum(SALARY_PERIODS_VALUES).default("mensal"),
        })
        .refine((rule) => rule.min === null || rule.min <= rule.amount, {
          message: "minAboveTarget",
          path: ["min"],
        })
    )
    .min(1)
    .max(22),
})
export type SalaryRulesInput = z.infer<typeof salaryRulesInputSchema>

export const languageLevelInputSchema = z.object({
  language: z.string().trim().min(2).max(60),
  level: z.enum(LANGUAGE_LEVEL_VALUES),
})
export type LanguageLevelInput = z.infer<typeof languageLevelInputSchema>

export const companyInputSchema = z.object({
  company: z.string().max(160).transform(collapse).pipe(z.string().min(1)),
})

// ---------------------------------------------------------------------------
// Memory (RF14.5): every change with origin, original phrase, diff and status
// ---------------------------------------------------------------------------

export const MEMORY_INTENTS = [
  "create_saved_search",
  "update_saved_search",
  "delete_saved_search",
  "add_excluded_company",
  "remove_excluded_company",
  "update_language_level",
  "set_salary_rules",
  "set_preference",
  "set_approval_mode",
] as const
export type MemoryIntent = (typeof MEMORY_INTENTS)[number]

export const MEMORY_ORIGINS = ["chat", "formulario", "automacao"] as const
export type MemoryOrigin = (typeof MEMORY_ORIGINS)[number]

export const MEMORY_STATUSES = [
  "aplicada",
  "desfeita",
  "pendente",
  "cancelada",
] as const
export type MemoryStatus = (typeof MEMORY_STATUSES)[number]

export function isMemoryIntent(value: unknown): value is MemoryIntent {
  return (
    typeof value === "string" &&
    (MEMORY_INTENTS as readonly string[]).includes(value)
  )
}

export type DiffEntry = { field: string; before: unknown; after: unknown }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

/** "Antes → depois" entries for the confirmation card (RF14.3). Objects are compared per key. */
export function diffValues(before: unknown, after: unknown): DiffEntry[] {
  if (isPlainObject(before) || isPlainObject(after)) {
    const left = isPlainObject(before) ? before : {}
    const right = isPlainObject(after) ? after : {}
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])]
    return keys
      .filter((key) => !sameValue(left[key], right[key]))
      .map((key) => ({
        field: key,
        before: left[key] ?? null,
        after: right[key] ?? null,
      }))
  }
  return sameValue(before, after)
    ? []
    : [{ field: "value", before: before ?? null, after: after ?? null }]
}
