import { z } from "zod"

import { APPLICATION_STATUSES } from "@vagapilot/core/status"
import {
  APPLICATION_ROUTES,
  FIT_LEVELS,
  JOB_SOURCES,
  NO_FIT,
  PERIOD_PRESETS,
  type TrackerFilters,
} from "@vagapilot/core/tracker"
import { IMPORT_FIELDS } from "@vagapilot/core/tracker-csv"

/** Zod messages are i18n keys under `Tracker.form.errors`. */
const text = (max: number) => z.string().trim().max(max, "tooLong")
const optionalText = (max: number) =>
  text(max).transform((value) => (value === "" ? null : value))

const optionalUrl = z
  .string()
  .trim()
  .max(2000, "tooLong")
  .refine(
    (value) =>
      value === "" || z.url({ protocol: /^https?$/ }).safeParse(value).success,
    "invalidUrl"
  )
  .transform((value) => (value === "" ? null : value))

const optionalDateTime = z
  .string()
  .trim()
  .refine(
    (value) => value === "" || !Number.isNaN(new Date(value).getTime()),
    "invalidDate"
  )
  .transform((value) => (value === "" ? null : new Date(value).toISOString()))

export const applicationStatusSchema = z.enum(APPLICATION_STATUSES)
export const jobSourceSchema = z.enum(JOB_SOURCES)
export const applicationRouteSchema = z.enum(APPLICATION_ROUTES)

/** Manual creation form (P3.1). Dates arrive as ISO strings built on the client. */
export const createApplicationSchema = z.object({
  company: text(200).min(1, "required"),
  roleTitle: text(200).min(1, "required"),
  link: optionalUrl,
  source: jobSourceSchema,
  route: applicationRouteSchema,
  status: applicationStatusSchema,
  appliedAt: optionalDateTime,
  cvVersionId: z
    .string()
    .trim()
    .transform((value) => (value === "" ? null : value))
    .pipe(z.uuid().nullable()),
  salaryInformed: optionalText(200),
  nextAction: optionalText(300),
  nextActionDueAt: optionalDateTime,
  notes: optionalText(5000),
})

export type CreateApplicationInput = z.input<typeof createApplicationSchema>

export const changeStatusSchema = z.object({
  id: z.uuid(),
  from: applicationStatusSchema,
  to: applicationStatusSchema,
})

export const nextActionSchema = z.object({
  id: z.uuid(),
  action: optionalText(300),
  dueAt: optionalDateTime,
})

export const notesSchema = z.object({
  id: z.uuid(),
  notes: optionalText(5000),
})

export const idSchema = z.object({ id: z.uuid() })

const MAX_IMPORT_BYTES = 2 * 1024 * 1024

export const importSchema = z.object({
  csv: z.string().min(1).max(MAX_IMPORT_BYTES),
  mapping: z.object(
    Object.fromEntries(
      IMPORT_FIELDS.map((field) => [
        field,
        z.number().int().min(0).max(200).nullable(),
      ])
    ) as Record<(typeof IMPORT_FIELDS)[number], z.ZodNullable<z.ZodNumber>>
  ),
})

export const IMPORT_MAX_BYTES = MAX_IMPORT_BYTES

function listParam<T extends string>(values: readonly [T, ...T[]]) {
  return z
    .string()
    .optional()
    .transform((value) => (value ? value.split(",").filter(Boolean) : []))
    .pipe(z.array(z.enum(values)))
}

/** Query string of GET /api/applications/export (mirrors the table filters). */
export const exportQuerySchema = z.object({
  format: z.enum(["csv", "pdf"]),
  q: z.string().trim().max(200).optional(),
  status: listParam(APPLICATION_STATUSES),
  source: listParam(JOB_SOURCES),
  route: listParam(APPLICATION_ROUTES),
  fit: listParam([...FIT_LEVELS, NO_FIT] as const),
  period: z.enum(PERIOD_PRESETS).optional(),
})

export type ExportFormat = z.infer<typeof exportQuerySchema>["format"]

/** Serializes filters for the export link; inverse of `exportQuerySchema`. */
export function filtersToSearchParams(
  filters: TrackerFilters,
  format: ExportFormat
): URLSearchParams {
  const params = new URLSearchParams({ format })
  if (filters.q?.trim()) params.set("q", filters.q.trim())
  if (filters.status?.length) params.set("status", filters.status.join(","))
  if (filters.source?.length) params.set("source", filters.source.join(","))
  if (filters.route?.length) params.set("route", filters.route.join(","))
  if (filters.fit?.length) params.set("fit", filters.fit.join(","))
  if (filters.period && filters.period !== "tudo")
    params.set("period", filters.period)
  return params
}
