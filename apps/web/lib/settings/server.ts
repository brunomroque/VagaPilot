import "server-only"

import { getTranslations } from "next-intl/server"

import { normalizeCompanyName } from "@vagapilot/core/blocklist"
import {
  normalizeLanguageName,
  type Seniority,
} from "@vagapilot/core/job-rules"
import {
  isAllowedNow,
  policyCheck,
  type ToolOrigin,
} from "@vagapilot/core/policy"
import {
  applySavedSearchPatch,
  companyInputSchema,
  DEFAULT_APPROVAL_MODE,
  diffValues,
  isMemoryIntent,
  isPreferenceKey,
  languageLevelInputSchema,
  normalizeSavedSearch,
  parsePreferenceValue,
  PREFERENCE_DEFAULTS,
  PREFERENCE_KEYS,
  salaryRulesInputSchema,
  savedSearchFromRow,
  savedSearchPatchSchema,
  savedSearchToRow,
  type ApprovalMode,
  type MemoryIntent,
  type MemoryOrigin,
  type PreferenceKey,
  type SavedSearch,
  type SavedSearchRow,
} from "@vagapilot/core/settings"
import { z } from "zod"

import type { DiffRow, SettingsChangeOutput } from "@/lib/chat/types"
import { audit } from "@/lib/server/audit"
import type { UserContext } from "@/lib/server/context"

/*
 * F14 settings service (RF14.1–RF14.6). Chat tools and forms both call `applySettingChange`,
 * so the same request writes the same record and the same Memory event (CA14.4, CA14.7).
 * Every write runs under the user's RLS session; `before` keeps the exact previous state so
 * undo restores it (CA14.2). Sensitive intents stop at a pending event until confirmed (CA14.3).
 */

export type SettingIntent = MemoryIntent

export type ApplySettingInput = {
  intent: SettingIntent
  input: unknown
  origin: MemoryOrigin
  policyOrigin: ToolOrigin
  confirmed?: boolean
  utterance?: string | null
  conversationId?: string | null
}

type SearchRow = SavedSearchRow & {
  id: string
  user_id: string
  active: boolean
  last_run_at: string | null
  created_at: string
}

type Plan = {
  targetType: string
  targetId: string | null
  before: unknown
  after: unknown
}

class SettingsError extends Error {
  constructor(
    readonly code:
      | "not_found"
      | "invalid_request"
      | "superseded"
      | "write_failed"
      | "denied",
    message: string
  ) {
    super(message)
  }
}

class Clarification extends Error {
  constructor(
    readonly question: string,
    readonly options: string[]
  ) {
    super("clarification")
  }
}

function check<T>(
  result: { data: T; error: { message: string } | null },
  label: string
): T {
  if (result.error)
    throw new SettingsError("write_failed", `${label}: ${result.error.message}`)
  return result.data
}

const SEARCH_SNAPSHOT_FIELDS = [
  "id",
  "query",
  "seniority",
  "location",
  "radius_km",
  "work_model",
  "regime",
  "language",
  "salary_min",
  "salary_max",
  "posted_within_days",
  "excluded_companies",
  "frequency",
  "time_of_day",
  "active",
  "last_run_at",
  "created_at",
] as const

function searchSnapshot(row: SearchRow): Record<string, unknown> {
  return Object.fromEntries(
    SEARCH_SNAPSHOT_FIELDS.map((field) => [field, row[field] ?? null])
  )
}

async function userSearches(ctx: UserContext): Promise<SearchRow[]> {
  return check(
    await ctx.supabase
      .from("saved_searches")
      .select("*")
      .eq("user_id", ctx.user.id)
      .order("created_at", { ascending: true }),
    "saved_searches"
  ) as SearchRow[]
}

async function resolveSearch(
  ctx: UserContext,
  selector: { id?: string; match?: string }
): Promise<SearchRow> {
  const searches = await userSearches(ctx)
  if (selector.id) {
    const found = searches.find((search) => search.id === selector.id)
    if (!found) throw new SettingsError("not_found", "Saved search not found.")
    return found
  }
  const wanted = normalizeCompanyName(selector.match ?? "")
  const candidates = wanted
    ? searches.filter((search) =>
        normalizeCompanyName(search.query).includes(wanted)
      )
    : searches
  const [first, ...rest] = candidates
  if (!first) throw new SettingsError("not_found", "Saved search not found.")
  if (rest.length > 0) {
    throw new Clarification(
      "Qual busca?",
      candidates.slice(0, 6).map((search) => search.query)
    )
  }
  return first
}

async function excludedRow(ctx: UserContext, company: string) {
  const normalized = normalizeCompanyName(company)
  const rows = check(
    await ctx.supabase
      .from("excluded_companies")
      .select("id, company_name, normalized_name, created_at")
      .eq("user_id", ctx.user.id)
      .eq("normalized_name", normalized),
    "excluded_companies"
  ) as {
    id: string
    company_name: string
    normalized_name: string
    created_at: string
  }[]
  return { normalized, row: rows[0] ?? null }
}

async function languageRow(ctx: UserContext, language: string) {
  const rows = check(
    await ctx.supabase
      .from("languages")
      .select("id, language, level, cefr")
      .eq("user_id", ctx.user.id),
    "languages"
  ) as { id: string; language: string; level: string; cefr: string | null }[]
  const code = normalizeLanguageName(language)
  return (
    rows.find((row) => normalizeLanguageName(row.language) === code) ?? null
  )
}

type SalaryRow = {
  id: string
  seniority: Seniority
  regime: string
  amount_min: number | string | null
  amount_target: number | string
  currency: string | null
  period: string | null
}

function salarySnapshot(row: SalaryRow) {
  return {
    seniority: row.seniority,
    regime: row.regime,
    amount_min: row.amount_min === null ? null : Number(row.amount_min),
    amount_target: Number(row.amount_target),
    currency: row.currency ?? "BRL",
    period: row.period ?? "mensal",
  }
}

async function preferenceValue(
  ctx: UserContext,
  key: PreferenceKey
): Promise<unknown | null> {
  const rows = check(
    await ctx.supabase
      .from("preferences")
      .select("value")
      .eq("user_id", ctx.user.id)
      .eq("key", key),
    "preferences"
  ) as { value: unknown }[]
  return rows[0] ? rows[0].value : null
}

async function approvalMode(ctx: UserContext): Promise<ApprovalMode | null> {
  const rows = check(
    await ctx.supabase
      .from("user_settings")
      .select("approval_mode")
      .eq("user_id", ctx.user.id),
    "user_settings"
  ) as { approval_mode: ApprovalMode }[]
  return rows[0]?.approval_mode ?? null
}

/** Builds before/after for a request without writing anything. */
async function plan(
  ctx: UserContext,
  intent: SettingIntent,
  input: unknown
): Promise<Plan> {
  switch (intent) {
    case "create_saved_search": {
      const search = normalizeSavedSearch(
        input as Parameters<typeof normalizeSavedSearch>[0]
      )
      return {
        targetType: "saved_search",
        targetId: null,
        before: null,
        after: search,
      }
    }
    case "update_saved_search": {
      const parsed = z
        .object({
          id: z.uuid().optional(),
          match: z.string().max(120).optional(),
          changes: savedSearchPatchSchema,
        })
        .parse(input)
      const row = await resolveSearch(ctx, parsed)
      const before = savedSearchFromRow(row)
      return {
        targetType: "saved_search",
        targetId: row.id,
        before,
        after: applySavedSearchPatch(before, parsed.changes),
      }
    }
    case "delete_saved_search": {
      const parsed = z
        .object({
          id: z.uuid().optional(),
          match: z.string().max(120).optional(),
        })
        .parse(input)
      const row = await resolveSearch(ctx, parsed)
      return {
        targetType: "saved_search",
        targetId: row.id,
        before: searchSnapshot(row),
        after: null,
      }
    }
    case "add_excluded_company": {
      const { company } = companyInputSchema.parse(input)
      const { normalized, row } = await excludedRow(ctx, company)
      return {
        targetType: "excluded_company",
        targetId: row?.id ?? null,
        before: row
          ? {
              company_name: row.company_name,
              normalized_name: row.normalized_name,
            }
          : null,
        after: { company_name: company, normalized_name: normalized },
      }
    }
    case "remove_excluded_company": {
      const { company } = companyInputSchema.parse(input)
      const { row } = await excludedRow(ctx, company)
      if (!row) throw new SettingsError("not_found", "Company is not excluded.")
      return {
        targetType: "excluded_company",
        targetId: row.id,
        before: {
          id: row.id,
          company_name: row.company_name,
          normalized_name: row.normalized_name,
          created_at: row.created_at,
        },
        after: null,
      }
    }
    case "update_language_level": {
      const parsed = languageLevelInputSchema.parse(input)
      const row = await languageRow(ctx, parsed.language)
      return {
        targetType: "language",
        targetId: row?.id ?? null,
        before: row
          ? { language: row.language, level: row.level, cefr: row.cefr }
          : null,
        after: {
          language: row?.language ?? parsed.language,
          level: parsed.level,
          cefr: null,
        },
      }
    }
    case "set_salary_rules": {
      const { rules } = salaryRulesInputSchema.parse(input)
      const existing = check(
        await ctx.supabase
          .from("salary_rules")
          .select(
            "id, seniority, regime, amount_min, amount_target, currency, period"
          )
          .eq("user_id", ctx.user.id),
        "salary_rules"
      ) as SalaryRow[]
      const after = rules.map((rule) => ({
        seniority: rule.seniority,
        regime: rule.regime,
        amount_min: rule.min,
        amount_target: rule.amount,
        currency: rule.currency,
        period: rule.period,
      }))
      const before = after.map((rule) => {
        const found = existing.find(
          (row) =>
            row.seniority === rule.seniority && row.regime === rule.regime
        )
        return found
          ? salarySnapshot(found)
          : { seniority: rule.seniority, regime: rule.regime, absent: true }
      })
      return { targetType: "salary_rules", targetId: null, before, after }
    }
    case "set_preference": {
      const parsed = z
        .object({ key: z.string(), value: z.unknown() })
        .parse(input)
      if (!isPreferenceKey(parsed.key))
        throw new SettingsError("invalid_request", "Unknown preference.")
      const value = parsePreferenceValue(parsed.key, parsed.value)
      if (!value.ok)
        throw new SettingsError("invalid_request", "Invalid preference value.")
      return {
        targetType: `preference:${parsed.key}`,
        targetId: null,
        before: {
          key: parsed.key,
          value: await preferenceValue(ctx, parsed.key),
        },
        after: { key: parsed.key, value: value.value },
      }
    }
    case "set_approval_mode": {
      const parsed = z
        .object({ mode: z.enum(["pausar_antes", "envie_direto"]) })
        .parse(input)
      return {
        targetType: "user_settings",
        targetId: null,
        before: { approval_mode: await approvalMode(ctx) },
        after: { approval_mode: parsed.mode },
      }
    }
    default: {
      const unreachable: never = intent
      throw new SettingsError(
        "invalid_request",
        `Unknown intent: ${String(unreachable)}`
      )
    }
  }
}

/** Writes `after`. Returns the id of the written row when there is one. */
async function write(
  ctx: UserContext,
  intent: SettingIntent,
  current: Plan
): Promise<string | null> {
  const userId = ctx.user.id
  switch (intent) {
    case "create_saved_search": {
      const data = check(
        await ctx.supabase
          .from("saved_searches")
          .insert({
            user_id: userId,
            ...savedSearchToRow(current.after as SavedSearch),
          })
          .select("id")
          .single(),
        "saved_searches insert"
      ) as { id: string }
      return data.id
    }
    case "update_saved_search": {
      check(
        await ctx.supabase
          .from("saved_searches")
          .update(savedSearchToRow(current.after as SavedSearch))
          .eq("id", current.targetId ?? "")
          .eq("user_id", userId),
        "saved_searches update"
      )
      return current.targetId
    }
    case "delete_saved_search": {
      check(
        await ctx.supabase
          .from("saved_searches")
          .delete()
          .eq("id", current.targetId ?? "")
          .eq("user_id", userId),
        "saved_searches delete"
      )
      return current.targetId
    }
    case "add_excluded_company": {
      const after = current.after as {
        company_name: string
        normalized_name: string
      }
      const data = check(
        await ctx.supabase
          .from("excluded_companies")
          .insert({ user_id: userId, ...after })
          .select("id")
          .single(),
        "excluded_companies insert"
      ) as { id: string }
      return data.id
    }
    case "remove_excluded_company": {
      check(
        await ctx.supabase
          .from("excluded_companies")
          .delete()
          .eq("id", current.targetId ?? "")
          .eq("user_id", userId),
        "excluded_companies delete"
      )
      return current.targetId
    }
    case "update_language_level": {
      const after = current.after as {
        language: string
        level: string
        cefr: string | null
      }
      if (current.targetId) {
        check(
          await ctx.supabase
            .from("languages")
            .update({ level: after.level, cefr: after.cefr })
            .eq("id", current.targetId)
            .eq("user_id", userId),
          "languages update"
        )
        return current.targetId
      }
      const data = check(
        await ctx.supabase
          .from("languages")
          .insert({ user_id: userId, ...after })
          .select("id")
          .single(),
        "languages insert"
      ) as { id: string }
      return data.id
    }
    case "set_salary_rules": {
      const rules = current.after as ReturnType<typeof salarySnapshot>[]
      check(
        await ctx.supabase.from("salary_rules").upsert(
          rules.map((rule) => ({ user_id: userId, ...rule })),
          { onConflict: "user_id,seniority,regime" }
        ),
        "salary_rules upsert"
      )
      return null
    }
    case "set_preference": {
      const after = current.after as { key: PreferenceKey; value: unknown }
      check(
        await ctx.supabase
          .from("preferences")
          .upsert(
            { user_id: userId, key: after.key, value: after.value },
            { onConflict: "user_id,key" }
          ),
        "preferences upsert"
      )
      return null
    }
    case "set_approval_mode": {
      const after = current.after as { approval_mode: ApprovalMode }
      check(
        await ctx.supabase
          .from("user_settings")
          .upsert(
            { user_id: userId, approval_mode: after.approval_mode },
            { onConflict: "user_id" }
          ),
        "user_settings upsert"
      )
      return null
    }
    default: {
      const unreachable: never = intent
      throw new SettingsError(
        "invalid_request",
        `Unknown intent: ${String(unreachable)}`
      )
    }
  }
}

/** Restores `before` exactly (CA14.2). */
async function restore(
  ctx: UserContext,
  intent: SettingIntent,
  event: Plan
): Promise<void> {
  const userId = ctx.user.id
  switch (intent) {
    case "create_saved_search":
    case "add_excluded_company": {
      const table =
        intent === "create_saved_search"
          ? "saved_searches"
          : "excluded_companies"
      check(
        await ctx.supabase
          .from(table)
          .delete()
          .eq("id", event.targetId ?? "")
          .eq("user_id", userId),
        table
      )
      return
    }
    case "update_saved_search": {
      check(
        await ctx.supabase
          .from("saved_searches")
          .update(savedSearchToRow(event.before as SavedSearch))
          .eq("id", event.targetId ?? "")
          .eq("user_id", userId),
        "saved_searches restore"
      )
      return
    }
    case "delete_saved_search": {
      check(
        await ctx.supabase.from("saved_searches").insert({
          user_id: userId,
          ...(event.before as Record<string, unknown>),
        }),
        "saved_searches restore"
      )
      return
    }
    case "remove_excluded_company": {
      check(
        await ctx.supabase.from("excluded_companies").insert({
          user_id: userId,
          ...(event.before as Record<string, unknown>),
        }),
        "excluded_companies restore"
      )
      return
    }
    case "update_language_level": {
      const before = event.before as {
        language: string
        level: string
        cefr: string | null
      } | null
      if (!before) {
        check(
          await ctx.supabase
            .from("languages")
            .delete()
            .eq("id", event.targetId ?? "")
            .eq("user_id", userId),
          "languages"
        )
        return
      }
      check(
        await ctx.supabase
          .from("languages")
          .update({ level: before.level, cefr: before.cefr })
          .eq("id", event.targetId ?? "")
          .eq("user_id", userId),
        "languages restore"
      )
      return
    }
    case "set_salary_rules": {
      for (const rule of event.before as (
        | ReturnType<typeof salarySnapshot>
        | { seniority: string; regime: string; absent: true }
      )[]) {
        if ("absent" in rule) {
          check(
            await ctx.supabase
              .from("salary_rules")
              .delete()
              .eq("user_id", userId)
              .eq("seniority", rule.seniority)
              .eq("regime", rule.regime),
            "salary_rules restore"
          )
        } else {
          check(
            await ctx.supabase
              .from("salary_rules")
              .upsert(
                { user_id: userId, ...rule },
                { onConflict: "user_id,seniority,regime" }
              ),
            "salary_rules restore"
          )
        }
      }
      return
    }
    case "set_preference": {
      const before = event.before as { key: PreferenceKey; value: unknown }
      if (before.value === null) {
        check(
          await ctx.supabase
            .from("preferences")
            .delete()
            .eq("user_id", userId)
            .eq("key", before.key),
          "preferences"
        )
      } else {
        check(
          await ctx.supabase
            .from("preferences")
            .upsert(
              { user_id: userId, key: before.key, value: before.value },
              { onConflict: "user_id,key" }
            ),
          "preferences restore"
        )
      }
      return
    }
    case "set_approval_mode": {
      const before = event.before as { approval_mode: ApprovalMode | null }
      if (before.approval_mode === null) {
        check(
          await ctx.supabase
            .from("user_settings")
            .delete()
            .eq("user_id", userId),
          "user_settings"
        )
      } else {
        check(
          await ctx.supabase
            .from("user_settings")
            .upsert(
              { user_id: userId, approval_mode: before.approval_mode },
              { onConflict: "user_id" }
            ),
          "user_settings restore"
        )
      }
      return
    }
    default: {
      const unreachable: never = intent
      throw new SettingsError(
        "invalid_request",
        `Unknown intent: ${String(unreachable)}`
      )
    }
  }
}

function auditActionFor(intent: SettingIntent) {
  switch (intent) {
    case "create_saved_search":
      return "search.created" as const
    case "update_saved_search":
      return "search.updated" as const
    case "delete_saved_search":
      return "search.deleted" as const
    case "add_excluded_company":
    case "remove_excluded_company":
    case "update_language_level":
    case "set_salary_rules":
    case "set_preference":
    case "set_approval_mode":
      return "settings.changed" as const
    default: {
      const unreachable: never = intent
      throw new Error(`Unknown intent: ${String(unreachable)}`)
    }
  }
}

function diffRows(before: unknown, after: unknown): DiffRow[] {
  return diffValues(before, after).filter(
    (row) =>
      !["id", "created_at", "last_run_at", "normalized_name"].includes(
        row.field
      )
  )
}

async function summaryFor(
  intent: SettingIntent,
  status: "applied" | "pending" | "undone" | "cancelled",
  current: Plan
): Promise<string> {
  const t = await getTranslations("ChatTools.settings")
  const subject = (() => {
    const after = (current.after ?? current.before) as
      Record<string, unknown> | unknown[] | null
    if (!after || Array.isArray(after)) return ""
    return String(
      after.query ??
        after.company_name ??
        after.language ??
        after.key ??
        after.approval_mode ??
        ""
    )
  })()
  return t(`${status}.${intent}`, { subject })
}

async function recordEvent(
  ctx: UserContext,
  input: ApplySettingInput,
  current: Plan,
  status: "aplicada" | "pendente"
): Promise<string> {
  const data = check(
    await ctx.supabase
      .from("memory_events")
      .insert({
        user_id: ctx.user.id,
        intent: input.intent,
        origin: input.origin,
        utterance: input.utterance?.slice(0, 2000) ?? null,
        target_type: current.targetType,
        target_id: current.targetId,
        before: current.before,
        after: current.after,
        status,
        conversation_id: input.conversationId ?? null,
        decided_at: status === "aplicada" ? new Date().toISOString() : null,
      })
      .select("id")
      .single(),
    "memory_events insert"
  ) as { id: string }
  return data.id
}

async function errorOutput(
  intent: string,
  error: unknown
): Promise<SettingsChangeOutput> {
  const t = await getTranslations("ChatTools.settings")
  if (error instanceof Clarification) {
    return {
      kind: "settings_change",
      status: "clarification",
      intent,
      question: error.question,
      options: error.options,
      summary: error.question,
    }
  }
  const code =
    error instanceof SettingsError
      ? error.code
      : error instanceof z.ZodError
        ? "invalid_request"
        : "write_failed"
  if (!(error instanceof SettingsError) && !(error instanceof z.ZodError)) {
    console.error("settings change failed", {
      intent,
      reason: error instanceof Error ? error.message : "unknown",
    })
  }
  return {
    kind: "settings_change",
    status: "error",
    intent,
    code,
    summary: t(`errors.${code}`),
  }
}

/** Single entry point for chat tools and forms (policy → plan → write → Memory → audit). */
export async function applySettingChange(
  ctx: UserContext,
  input: ApplySettingInput
): Promise<SettingsChangeOutput> {
  try {
    const decision = policyCheck({
      tool: input.intent,
      origin: input.policyOrigin,
      confirmed: input.confirmed,
    })
    if (decision.decision === "deny")
      throw new SettingsError("denied", "Not allowed from this origin.")
    const current = await plan(ctx, input.intent, input.input)

    if (input.intent === "add_excluded_company" && current.before) {
      const t = await getTranslations("ChatTools.settings")
      return {
        kind: "settings_change",
        status: "noop",
        intent: input.intent,
        summary: t("noop.add_excluded_company"),
      }
    }

    if (!isAllowedNow(decision)) {
      const memoryEventId = await recordEvent(ctx, input, current, "pendente")
      return {
        kind: "settings_change",
        status: "pending",
        intent: input.intent,
        memoryEventId,
        diff: diffRows(current.before, current.after),
        summary: await summaryFor(input.intent, "pending", current),
      }
    }

    const targetId = await write(ctx, input.intent, current)
    const applied = { ...current, targetId: current.targetId ?? targetId }
    if (
      input.origin === "chat" &&
      input.conversationId &&
      applied.targetId &&
      applied.targetType === "saved_search"
    ) {
      const { linkChatRecord } = await import("@/lib/chat/record-links")
      await linkChatRecord(ctx, {
        conversationId: input.conversationId,
        tableName: "saved_searches",
        recordId: applied.targetId,
        action: "created",
      })
    }
    const memoryEventId = await recordEvent(ctx, input, applied, "aplicada")
    await audit({
      userId: ctx.user.id,
      actor: input.origin === "chat" ? "agente" : "usuario",
      action: auditActionFor(input.intent),
      targetType: applied.targetType,
      targetId: applied.targetId ?? undefined,
      details: {
        intent: input.intent,
        origin: input.origin,
        memory_event_id: memoryEventId,
      },
    })
    return {
      kind: "settings_change",
      status: "applied",
      intent: input.intent,
      memoryEventId,
      diff: diffRows(applied.before, applied.after),
      summary: await summaryFor(input.intent, "applied", applied),
    }
  } catch (error) {
    return errorOutput(input.intent, error)
  }
}

type MemoryRow = {
  id: string
  intent: string
  origin: MemoryOrigin
  target_type: string
  target_id: string | null
  before: unknown
  after: unknown
  status: string
  created_at: string
}

async function loadEvent(ctx: UserContext, id: string): Promise<MemoryRow> {
  const rows = check(
    await ctx.supabase
      .from("memory_events")
      .select(
        "id, intent, origin, target_type, target_id, before, after, status, created_at"
      )
      .eq("id", id)
      .eq("user_id", ctx.user.id),
    "memory_events"
  ) as MemoryRow[]
  const row = rows[0]
  if (!row || !isMemoryIntent(row.intent))
    throw new SettingsError("not_found", "Memory event not found.")
  return row
}

/** "Confirmar" on a pending card (widget or form): the person's click is the only confirmation. */
export async function confirmPendingChange(
  ctx: UserContext,
  memoryEventId: string
): Promise<SettingsChangeOutput> {
  let intent = "unknown"
  try {
    const event = await loadEvent(ctx, memoryEventId)
    intent = event.intent
    if (event.status !== "pendente")
      throw new SettingsError("superseded", "Already decided.")
    const memoryIntent = event.intent as SettingIntent
    const decision = policyCheck({
      tool: memoryIntent,
      origin: "widget",
      confirmed: true,
    })
    if (!isAllowedNow(decision))
      throw new SettingsError("denied", "Not allowed.")
    const fresh = await plan(
      ctx,
      memoryIntent,
      planInputFromEvent(memoryIntent, event)
    )
    const targetId = await write(ctx, memoryIntent, {
      ...fresh,
      after: event.after ?? fresh.after,
    })
    const applied = {
      ...fresh,
      after: event.after ?? fresh.after,
      targetId: fresh.targetId ?? targetId,
    }
    check(
      await ctx.supabase
        .from("memory_events")
        .update({
          status: "aplicada",
          before: applied.before,
          target_id: applied.targetId,
          decided_at: new Date().toISOString(),
        })
        .eq("id", memoryEventId)
        .eq("user_id", ctx.user.id),
      "memory_events update"
    )
    await audit({
      userId: ctx.user.id,
      actor: "usuario",
      action: auditActionFor(memoryIntent),
      targetType: applied.targetType,
      targetId: applied.targetId ?? undefined,
      details: {
        intent: memoryIntent,
        origin: event.origin,
        memory_event_id: memoryEventId,
        confirmed: true,
      },
    })
    return {
      kind: "settings_change",
      status: "applied",
      intent: memoryIntent,
      memoryEventId,
      diff: diffRows(applied.before, applied.after),
      summary: await summaryFor(memoryIntent, "applied", applied),
    }
  } catch (error) {
    return errorOutput(intent, error)
  }
}

/** Rebuilds the request stored in a pending event so `plan` can re-read the current state. */
function planInputFromEvent(intent: SettingIntent, event: MemoryRow): unknown {
  const after = event.after as Record<string, unknown> | unknown[] | null
  switch (intent) {
    case "create_saved_search":
      return after
    case "update_saved_search":
      return {
        id: event.target_id ?? undefined,
        changes: savedSearchPatchSchema.parse(after ?? {}),
      }
    case "delete_saved_search":
      return { id: event.target_id ?? undefined }
    case "add_excluded_company":
    case "remove_excluded_company": {
      const source = (after ?? event.before) as { company_name?: string } | null
      return { company: source?.company_name ?? "" }
    }
    case "update_language_level":
      return after
    case "set_salary_rules":
      return {
        rules: ((after ?? []) as ReturnType<typeof salarySnapshot>[]).map(
          (rule) => ({
            seniority: rule.seniority,
            regime: rule.regime,
            amount: rule.amount_target,
            min: rule.amount_min,
            currency: rule.currency,
            period: rule.period,
          })
        ),
      }
    case "set_preference":
      return after
    case "set_approval_mode":
      return {
        mode: (after as { approval_mode?: string } | null)?.approval_mode,
      }
    default: {
      const unreachable: never = intent
      throw new SettingsError(
        "invalid_request",
        `Unknown intent: ${String(unreachable)}`
      )
    }
  }
}

export async function cancelPendingChange(
  ctx: UserContext,
  memoryEventId: string
): Promise<SettingsChangeOutput> {
  let intent = "unknown"
  try {
    const event = await loadEvent(ctx, memoryEventId)
    intent = event.intent
    if (event.status !== "pendente")
      throw new SettingsError("superseded", "Already decided.")
    check(
      await ctx.supabase
        .from("memory_events")
        .update({ status: "cancelada", decided_at: new Date().toISOString() })
        .eq("id", memoryEventId)
        .eq("user_id", ctx.user.id),
      "memory_events update"
    )
    const current = {
      targetType: event.target_type,
      targetId: event.target_id,
      before: event.before,
      after: event.after,
    }
    return {
      kind: "settings_change",
      status: "cancelled",
      intent,
      memoryEventId,
      diff: diffRows(event.before, event.after),
      summary: await summaryFor(intent as SettingIntent, "cancelled", current),
    }
  } catch (error) {
    return errorOutput(intent, error)
  }
}

/** "Desfazer" on the card or in Memória (RF14.5): restores `before` exactly (CA14.2). */
export async function undoMemoryEvent(
  ctx: UserContext,
  memoryEventId?: string
): Promise<SettingsChangeOutput> {
  let intent = "unknown"
  try {
    let id = memoryEventId
    if (!id) {
      const latest = check(
        await ctx.supabase
          .from("memory_events")
          .select("id")
          .eq("user_id", ctx.user.id)
          .eq("status", "aplicada")
          .order("created_at", { ascending: false })
          .limit(1),
        "memory_events"
      ) as { id: string }[]
      id = latest[0]?.id
      if (!id) throw new SettingsError("not_found", "Nothing to undo.")
    }
    const event = await loadEvent(ctx, id)
    intent = event.intent
    if (event.status !== "aplicada")
      throw new SettingsError("superseded", "Not applied.")
    const later = check(
      await ctx.supabase
        .from("memory_events")
        .select("id, target_id")
        .eq("user_id", ctx.user.id)
        .eq("status", "aplicada")
        .eq("target_type", event.target_type)
        .gt("created_at", event.created_at),
      "memory_events"
    ) as { id: string; target_id: string | null }[]
    if (later.some((row) => row.target_id === event.target_id)) {
      throw new SettingsError(
        "superseded",
        "A newer change touches the same setting."
      )
    }
    const memoryIntent = event.intent as SettingIntent
    const current = {
      targetType: event.target_type,
      targetId: event.target_id,
      before: event.before,
      after: event.after,
    }
    await restore(ctx, memoryIntent, current)
    check(
      await ctx.supabase
        .from("memory_events")
        .update({ status: "desfeita", decided_at: new Date().toISOString() })
        .eq("id", event.id)
        .eq("user_id", ctx.user.id),
      "memory_events update"
    )
    await audit({
      userId: ctx.user.id,
      actor: "usuario",
      action: "settings.undone",
      targetType: event.target_type,
      targetId: event.target_id ?? undefined,
      details: { intent: memoryIntent, memory_event_id: event.id },
    })
    return {
      kind: "settings_change",
      status: "undone",
      intent: memoryIntent,
      memoryEventId: event.id,
      diff: diffRows(event.after, event.before),
      summary: await summaryFor(memoryIntent, "undone", current),
    }
  } catch (error) {
    return errorOutput(intent, error)
  }
}

export type SettingsSnapshot = {
  approvalMode: ApprovalMode
  preferences: Record<PreferenceKey, unknown>
  savedSearches: (SavedSearch & {
    id: string
    active: boolean
    lastRunAt: string | null
  })[]
  excludedCompanies: { id: string; name: string }[]
  blockedCompanies: string[]
  languages: { language: string; level: string; cefr: string | null }[]
  salaryRules: ReturnType<typeof salarySnapshot>[]
}

/** `get_settings` (RF14.6): typed settings read by tool, not from chat history. */
export async function getSettingsSnapshot(
  ctx: UserContext
): Promise<SettingsSnapshot> {
  const userId = ctx.user.id
  const [mode, preferences, searches, excluded, blocked, languages, salary] =
    await Promise.all([
      approvalMode(ctx),
      ctx.supabase
        .from("preferences")
        .select("key, value")
        .eq("user_id", userId),
      userSearches(ctx),
      ctx.supabase
        .from("excluded_companies")
        .select("id, company_name")
        .eq("user_id", userId)
        .order("company_name"),
      ctx.supabase
        .from("company_blocklist")
        .select("company_name")
        .eq("user_id", userId),
      ctx.supabase
        .from("languages")
        .select("language, level, cefr")
        .eq("user_id", userId),
      ctx.supabase
        .from("salary_rules")
        .select(
          "id, seniority, regime, amount_min, amount_target, currency, period"
        )
        .eq("user_id", userId),
    ])
  const stored = new Map(
    (
      (check(preferences, "preferences") ?? []) as {
        key: string
        value: unknown
      }[]
    ).map((row) => [row.key, row.value])
  )
  return {
    approvalMode: mode ?? DEFAULT_APPROVAL_MODE,
    preferences: Object.fromEntries(
      PREFERENCE_KEYS.map((key) => [
        key,
        stored.has(key) ? stored.get(key) : PREFERENCE_DEFAULTS[key],
      ])
    ) as Record<PreferenceKey, unknown>,
    savedSearches: searches.map((row) => ({
      ...savedSearchFromRow(row),
      id: row.id,
      active: row.active,
      lastRunAt: row.last_run_at,
    })),
    excludedCompanies: (
      (check(excluded, "excluded_companies") ?? []) as {
        id: string
        company_name: string
      }[]
    ).map((row) => ({
      id: row.id,
      name: row.company_name,
    })),
    blockedCompanies: (
      (check(blocked, "company_blocklist") ?? []) as { company_name: string }[]
    ).map((row) => row.company_name),
    languages: (check(languages, "languages") ??
      []) as SettingsSnapshot["languages"],
    salaryRules: ((check(salary, "salary_rules") ?? []) as SalaryRow[]).map(
      salarySnapshot
    ),
  }
}
