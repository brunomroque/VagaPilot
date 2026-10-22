"use client"

import { useFormatter, useTranslations } from "next-intl"

import type { DiffRow } from "@/lib/chat/types"

const FIELD_KEYS = [
  "query",
  "seniority",
  "location",
  "radiusKm",
  "workModel",
  "regime",
  "language",
  "salaryMin",
  "salaryMax",
  "postedWithinDays",
  "excludedCompanies",
  "frequency",
  "timeOfDay",
  "company_name",
  "level",
  "cefr",
  "approval_mode",
  "value",
  "active",
  "work_model",
  "time_of_day",
  "excluded_companies",
  "posted_within_days",
  "salary_min",
  "salary_max",
  "radius_km",
] as const

type FieldKey = (typeof FIELD_KEYS)[number]

/** Human "antes → depois" rows for settings cards and the Memória page (RF14.3, RF14.5). */
export function useDiffFormat() {
  const t = useTranslations("SettingsModel")
  const format = useFormatter()
  const dynamic = t as unknown as ((key: string) => string) & {
    has: (key: string) => boolean
  }

  function enumLabel(value: string): string {
    const groups = [
      "seniority",
      "workModel",
      "frequency",
      "timeOfDay",
      "approvalMode",
      "fit",
      "level",
      "regime",
      "language",
    ] as const
    for (const group of groups) {
      const key = `values.${group}.${value}`
      if (dynamic.has(key)) return dynamic(key)
    }
    return value
  }

  function value(input: unknown): string {
    if (input === null || input === undefined || input === "") return "—"
    if (typeof input === "boolean") return input ? t("yes") : t("no")
    if (typeof input === "number") return format.number(input)
    if (typeof input === "string") return enumLabel(input)
    if (Array.isArray(input)) {
      if (input.length === 0) return "—"
      return input
        .map((item) => {
          if (item && typeof item === "object" && "seniority" in item) {
            const rule = item as {
              seniority: string
              regime: string
              amount_target?: number
              currency?: string
              absent?: boolean
            }
            const label = `${enumLabel(rule.seniority)} ${rule.regime.toUpperCase()}`
            return rule.absent || rule.amount_target === undefined
              ? `${label}: —`
              : `${label}: ${format.number(rule.amount_target, { style: "currency", currency: rule.currency ?? "BRL", maximumFractionDigits: 0 })}`
          }
          return value(item)
        })
        .join(", ")
    }
    if (typeof input === "object") {
      const record = input as Record<string, unknown>
      if ("value" in record) return value(record.value)
      return Object.values(record).map(value).join(" · ")
    }
    return String(input)
  }

  function field(intent: string, name: string): string {
    if (intent === "set_preference" && name === "value")
      return t("fields.preference")
    if (intent === "set_salary_rules") return t("fields.salaryRules")
    if ((FIELD_KEYS as readonly string[]).includes(name))
      return t(`fields.${name as FieldKey}`)
    return name
  }

  function preferenceValue(input: unknown): string {
    return input === null || input === undefined ? t("default") : value(input)
  }

  return (intent: string, rows: DiffRow[]) =>
    rows
      .filter((row) => row.field !== "key")
      .map((row) =>
        intent === "set_preference"
          ? {
              field: field(intent, row.field),
              before: preferenceValue(row.before),
              after: preferenceValue(row.after),
            }
          : {
              field: field(intent, row.field),
              before: value(row.before),
              after: value(row.after),
            }
      )
}
