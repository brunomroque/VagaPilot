"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import {
  PROVIDER_COLUMNS,
  PROVIDER_TYPES,
  providerFromRow,
  testProviderConnection,
  type ProviderTestResult,
} from "@vagapilot/browser-pool"

import { isAppAdmin } from "@/lib/admin/server"
import { getAdminClient } from "@/lib/server/admin"
import { audit } from "@/lib/server/audit"
import { getUserContext, type UserContext } from "@/lib/server/context"

type Result<T> = { ok: true; data: T } | { ok: false; error: string }

const envName = z
  .string()
  .regex(
    /^[A-Z][A-Z0-9_]*$/,
    "Use o NOME da variável (ex.: STEEL_API_KEY), nunca o valor."
  )

const providerSchema = z.object({
  provider: z.enum(PROVIDER_TYPES),
  label: z.string().min(1).max(80),
  accountEmail: z.email().nullable(),
  secretEnvVar: envName,
  projectEnvVar: envName.nullable(),
  enabled: z.boolean(),
  priority: z.number().int().min(0).max(10_000),
  concurrencyLimit: z.number().int().min(1).max(100),
  maxSessionSeconds: z.number().int().min(30).max(86_400).nullable(),
  quotaKind: z.enum(["units_monthly", "credits_monthly", "credits_one_time"]),
  quotaUnit: z.string().min(1).max(20),
  quotaLimit: z.number().min(0),
  costPerMinute: z.number().min(0),
  quotaResetDay: z.number().int().min(1).max(31).nullable(),
  keyExpiresAt: z.string().nullable(),
  alertThreshold: z.number().gt(0).max(1),
  notes: z.string().max(1000).nullable(),
})

export type ProviderInput = z.infer<typeof providerSchema>

async function adminContext(): Promise<UserContext | null> {
  const auth = await getUserContext()
  if (!auth.ok) return null
  return (await isAppAdmin(auth.ctx.supabase)) ? auth.ctx : null
}

function toRow(input: ProviderInput) {
  return {
    provider: input.provider,
    label: input.label,
    account_email: input.accountEmail,
    secret_env_var: input.secretEnvVar,
    project_env_var: input.projectEnvVar,
    enabled: input.enabled,
    priority: input.priority,
    concurrency_limit: input.concurrencyLimit,
    max_session_seconds: input.maxSessionSeconds,
    quota_kind: input.quotaKind,
    quota_unit: input.quotaUnit,
    quota_limit: input.quotaLimit,
    cost_per_minute: input.costPerMinute,
    quota_reset_day: input.quotaResetDay,
    key_expires_at: input.keyExpiresAt || null,
    alert_threshold: input.alertThreshold,
    notes: input.notes,
    updated_at: new Date().toISOString(),
  }
}

export async function saveProviderAction(
  id: string | null,
  input: unknown
): Promise<Result<{ id: string }>> {
  const ctx = await adminContext()
  if (!ctx) return { ok: false, error: "Acesso restrito a administradores." }
  const parsed = providerSchema.safeParse(input)
  if (!parsed.success)
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Dados inválidos.",
    }
  const row = toRow(parsed.data)
  const query = id
    ? ctx.supabase
        .from("browser_providers")
        .update(row)
        .eq("id", id)
        .select("id")
        .single()
    : ctx.supabase.from("browser_providers").insert(row).select("id").single()
  const { data, error } = await query
  if (error || !data)
    return { ok: false, error: error?.message ?? "Falha ao salvar." }
  await audit({
    userId: ctx.user.id,
    actor: "usuario",
    action: "browser_pool.provider_changed",
    targetType: "browser_provider",
    targetId: data.id as string,
    details: {
      op: id ? "update" : "create",
      provider: row.provider,
      enabled: row.enabled,
    },
  }).catch(() => undefined)
  revalidatePath("/app/admin")
  return { ok: true, data: { id: data.id as string } }
}

export async function deleteProviderAction(id: string): Promise<Result<null>> {
  const ctx = await adminContext()
  if (!ctx) return { ok: false, error: "Acesso restrito a administradores." }
  if (!z.uuid().safeParse(id).success)
    return { ok: false, error: "Id inválido." }
  const { error } = await ctx.supabase
    .from("browser_providers")
    .delete()
    .eq("id", id)
  if (error) return { ok: false, error: error.message }
  await audit({
    userId: ctx.user.id,
    actor: "usuario",
    action: "browser_pool.provider_changed",
    targetType: "browser_provider",
    targetId: id,
    details: { op: "delete" },
  }).catch(() => undefined)
  revalidatePath("/app/admin")
  return { ok: true, data: null }
}

export async function toggleProviderAction(
  id: string,
  enabled: boolean
): Promise<Result<null>> {
  const ctx = await adminContext()
  if (!ctx) return { ok: false, error: "Acesso restrito a administradores." }
  const { error } = await ctx.supabase
    .from("browser_providers")
    .update({ enabled, updated_at: new Date().toISOString() })
    .eq("id", id)
  if (error) return { ok: false, error: error.message }
  await audit({
    userId: ctx.user.id,
    actor: "usuario",
    action: "browser_pool.provider_changed",
    targetType: "browser_provider",
    targetId: id,
    details: { op: "toggle", enabled },
  }).catch(() => undefined)
  revalidatePath("/app/admin")
  return { ok: true, data: null }
}

/** Opens and closes a 60 s session on that provider (consumes a little quota; recorded as "test"). */
export async function testProviderAction(
  id: string
): Promise<Result<ProviderTestResult>> {
  const ctx = await adminContext()
  if (!ctx) return { ok: false, error: "Acesso restrito a administradores." }
  const admin = getAdminClient()
  if (!admin) return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY ausente." }
  const { data } = await ctx.supabase
    .from("browser_providers")
    .select(PROVIDER_COLUMNS)
    .eq("id", id)
    .maybeSingle()
  if (!data) return { ok: false, error: "Provedor não encontrado." }
  const config = providerFromRow(data as Record<string, unknown>)
  const result = await testProviderConnection({ admin }, config)
  await audit({
    userId: ctx.user.id,
    actor: "usuario",
    action: "browser_pool.provider_tested",
    targetType: "browser_provider",
    targetId: id,
    details: { ok: result.ok, latencyMs: result.latencyMs },
  }).catch(() => undefined)
  revalidatePath("/app/admin")
  return { ok: true, data: result }
}

// Learned ATS recipes (generic AI driver) ----------------------------------------------------

export type RecipeRow = {
  id: string
  domain: string
  platform: string
  version: number
  status: string
  steps: number
  successes: number
  failures: number
  last_validated_at: string | null
  drift_history: { at: string; step: number; score: number; level: string }[]
  updated_at: string
}

export async function listRecipesAction(): Promise<Result<RecipeRow[]>> {
  const ctx = await adminContext()
  if (!ctx) return { ok: false, error: "Acesso restrito a administradores." }
  const admin = getAdminClient()
  if (!admin) return { ok: false, error: "Servidor não configurado." }
  const { data, error } = await admin
    .from("ats_recipes")
    .select(
      "id, domain, platform, version, status, steps, successes, failures, last_validated_at, drift_history, updated_at"
    )
    .order("domain")
    .order("version", { ascending: false })
    .limit(200)
  if (error)
    return { ok: false, error: "Não foi possível carregar as receitas." }
  return {
    ok: true,
    data: (data ?? []).map((r) => ({
      ...(r as Omit<RecipeRow, "steps">),
      steps: Array.isArray(r.steps) ? r.steps.length : 0,
      drift_history: Array.isArray(r.drift_history)
        ? r.drift_history.slice(-10)
        : [],
    })),
  }
}

const recipeStatusSchema = z.object({
  id: z.uuid(),
  status: z.enum(["disabled", "learning", "stale"]),
})

/** Disable a recipe (AI only for that site), re-enable it (back to learning) or force relearn. */
export async function setRecipeStatusAction(
  input: z.infer<typeof recipeStatusSchema>
): Promise<Result<null>> {
  const ctx = await adminContext()
  if (!ctx) return { ok: false, error: "Acesso restrito a administradores." }
  const parsed = recipeStatusSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: "Dados inválidos." }
  const admin = getAdminClient()
  if (!admin) return { ok: false, error: "Servidor não configurado." }
  const { error } = await admin
    .from("ats_recipes")
    .update({
      status: parsed.data.status,
      disabled_by: parsed.data.status === "disabled" ? ctx.user.id : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", parsed.data.id)
  if (error)
    return { ok: false, error: "Não foi possível atualizar a receita." }
  await audit({
    userId: ctx.user.id,
    actor: "usuario",
    action: "browser_pool.recipe_changed",
    targetType: "ats_recipe",
    targetId: parsed.data.id,
    details: { status: parsed.data.status },
  }).catch(() => undefined)
  revalidatePath("/app/admin")
  return { ok: true, data: null }
}
