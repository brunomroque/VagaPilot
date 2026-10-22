import type { SavedSearch, SavedSearchInput } from "@vagapilot/core/settings"
import { z } from "zod"

/**
 * "Buscas" form (RF4A.3). Every field is a string in the form; `formToSearchInput` turns it
 * into the same input the chat tool produces, so both normalize to the same record (CA14.7).
 * Messages are keys of `Forms.validation`.
 */

export const ANY = ""

const amount = z
  .string()
  .trim()
  .refine(
    (value) =>
      value === "" || /^\d{1,9}([.,]\d{1,2})?$/.test(value.replace(/\./g, "")),
    "invalidAmount"
  )

export const searchFormSchema = z
  .object({
    query: z.string().trim().min(2, "required").max(120, "tooLong"),
    location: z.string().trim().max(120, "tooLong"),
    seniority: z.string(),
    workModel: z.string(),
    regime: z.string(),
    language: z.string(),
    salaryMin: amount,
    salaryMax: amount,
    postedWithinDays: z.string(),
    excludedCompanies: z.string().max(2000, "tooLong"),
    frequency: z.enum(["diaria", "dias_uteis", "semanal"]),
    timeOfDay: z.string(),
  })
  .refine(
    (value) =>
      value.salaryMin === "" ||
      value.salaryMax === "" ||
      parseAmountText(value.salaryMin) <= parseAmountText(value.salaryMax),
    { message: "minAboveTarget", path: ["salaryMin"] }
  )

export type SearchFormValues = z.infer<typeof searchFormSchema>

function parseAmountText(value: string): number {
  const normalized = value.includes(",")
    ? value.replace(/\./g, "").replace(",", ".")
    : value.replace(/\.(?=\d{3}\b)/g, "")
  return Number(normalized)
}

export const EMPTY_SEARCH_FORM: SearchFormValues = {
  query: "",
  location: "",
  seniority: ANY,
  workModel: ANY,
  regime: ANY,
  language: ANY,
  salaryMin: "",
  salaryMax: "",
  postedWithinDays: ANY,
  excludedCompanies: "",
  frequency: "diaria",
  timeOfDay: ANY,
}

function orNull<T extends string>(value: string): T | null {
  return value === ANY ? null : (value as T)
}

/** Values are checked again by `normalizeSavedSearch` (enum schemas) before any write. */
export function formToSearchInput(values: SearchFormValues): SavedSearchInput {
  return {
    query: values.query,
    location: values.location || null,
    seniority: orNull<NonNullable<SavedSearchInput["seniority"]>>(
      values.seniority
    ),
    workModel: orNull<NonNullable<SavedSearchInput["workModel"]>>(
      values.workModel
    ),
    regime: orNull<NonNullable<SavedSearchInput["regime"]>>(values.regime),
    language: orNull<NonNullable<SavedSearchInput["language"]>>(
      values.language
    ),
    salaryMin: values.salaryMin ? parseAmountText(values.salaryMin) : null,
    salaryMax: values.salaryMax ? parseAmountText(values.salaryMax) : null,
    postedWithinDays: values.postedWithinDays
      ? Number(values.postedWithinDays)
      : null,
    excludedCompanies: values.excludedCompanies
      .split(/[,;\n]/)
      .map((name) => name.trim())
      .filter(Boolean),
    frequency: values.frequency,
    timeOfDay: orNull<NonNullable<SavedSearchInput["timeOfDay"]>>(
      values.timeOfDay
    ),
  }
}

export function searchToForm(search: SavedSearch): SearchFormValues {
  return {
    query: search.query,
    location: search.location ?? "",
    seniority: search.seniority ?? ANY,
    workModel: search.workModel ?? ANY,
    regime: search.regime ?? ANY,
    language: search.language ?? ANY,
    salaryMin: search.salaryMin === null ? "" : String(search.salaryMin),
    salaryMax: search.salaryMax === null ? "" : String(search.salaryMax),
    postedWithinDays:
      search.postedWithinDays === null ? ANY : String(search.postedWithinDays),
    excludedCompanies: search.excludedCompanies.join(", "),
    frequency: search.frequency,
    timeOfDay: search.timeOfDay ?? ANY,
  }
}
