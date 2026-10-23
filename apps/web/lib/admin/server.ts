import "server-only"

import {
  PROVIDER_COLUMNS,
  providerAlerts,
  providerFromRow,
  quotaStatus,
  secretsFromEnv,
  usedUnitsFromDb,
  type ProviderAlert,
  type ProviderConfig,
  type QuotaStatus,
} from "@vagapilot/browser-pool"

import { createSupabaseServerClient } from "@/lib/supabase/server"
import type { UserContext } from "@/lib/server/context"

/** True when the signed-in user is in public.app_admins (RPC is security definer). */
export async function isAppAdmin(client?: UserContext["supabase"] | null): Promise<boolean> {
  try {
    const supabase = client ?? (await createSupabaseServerClient())
    if (!supabase) return false
    const { data, error } = await supabase.rpc("is_app_admin")
    return !error && data === true
  } catch {
    return false
  }
}

export type AdminProviderRow = ProviderConfig & {
  notes: string | null
  lastTestAt: string | null
  lastTestOk: boolean | null
  lastTestMessage: string | null
  hasSecret: boolean
  activeSessions: number
  quota: QuotaStatus
  alerts: ProviderAlert[]
}

export type AdminSessionRow = {
  id: string
  provider: string
  purpose: string
  status: string
  startedAt: string
  durationSeconds: number | null
  unitsUsed: number
  errorCode: string | null
  errorMessage: string | null
}

export type AdminDashboard = {
  providers: AdminProviderRow[]
  sessions: AdminSessionRow[]
  totals: { unit: string; used: number; limit: number; projected: number | null; percent: number }[]
  alerts: ProviderAlert[]
  poolEnabled: boolean
}

/** Everything is read through the user's RLS client: non-admins get empty results. */
export async function loadAdminDashboard(ctx: UserContext): Promise<AdminDashboard> {
  const { data, error } = await ctx.supabase
    .from("browser_providers")
    .select(`${PROVIDER_COLUMNS}, notes, last_test_at, last_test_ok, last_test_message`)
    .order("priority", { ascending: true })
  if (error) throw new Error(`browser_providers: ${error.message}`)
  const rows = (data ?? []) as Record<string, unknown>[]

  const active = await ctx.supabase.from("browser_sessions").select("provider_id").eq("status", "ativa").limit(1000)
  const activeBy = new Map<string, number>()
  for (const row of (active.data ?? []) as { provider_id: string | null }[])
    if (row.provider_id) activeBy.set(row.provider_id, (activeBy.get(row.provider_id) ?? 0) + 1)

  const providers: AdminProviderRow[] = []
  for (const row of rows) {
    const config = providerFromRow(row)
    const used = await usedUnitsFromDb(ctx.supabase, config)
    const quota = quotaStatus(config, used)
    const hasSecret = Boolean(secretsFromEnv(config))
    providers.push({
      ...config,
      notes: (row.notes as string | null) ?? null,
      lastTestAt: (row.last_test_at as string | null) ?? null,
      lastTestOk: (row.last_test_ok as boolean | null) ?? null,
      lastTestMessage: (row.last_test_message as string | null) ?? null,
      hasSecret,
      activeSessions: activeBy.get(config.id) ?? 0,
      quota,
      alerts: providerAlerts(config, quota, { hasSecret }),
    })
  }

  // Totals per unit (units, USD, min, credits) across enabled providers.
  const byUnit = new Map<string, { used: number; limit: number; projected: number | null }>()
  for (const p of providers.filter((x) => x.enabled)) {
    const cur = byUnit.get(p.quotaUnit) ?? { used: 0, limit: 0, projected: 0 }
    cur.used += p.quota.used
    cur.limit += p.quota.limit
    cur.projected = cur.projected === null || p.quota.projected === null ? (cur.projected ?? 0) + p.quota.used : cur.projected + p.quota.projected
    byUnit.set(p.quotaUnit, cur)
  }
  const totals = [...byUnit.entries()].map(([unit, v]) => ({
    unit,
    used: Math.round(v.used * 100) / 100,
    limit: v.limit,
    projected: v.projected === null ? null : Math.round(v.projected * 100) / 100,
    percent: v.limit > 0 ? v.used / v.limit : 1,
  }))

  const sess = await ctx.supabase
    .from("browser_sessions")
    .select("id, provider, purpose, status, started_at, duration_seconds, units_used, error_code, error_message")
    .order("started_at", { ascending: false })
    .limit(50)
  const sessions = ((sess.data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    provider: String(r.provider),
    purpose: String(r.purpose),
    status: String(r.status),
    startedAt: String(r.started_at),
    durationSeconds: r.duration_seconds == null ? null : Number(r.duration_seconds),
    unitsUsed: Number(r.units_used ?? 0),
    errorCode: (r.error_code as string | null) ?? null,
    errorMessage: (r.error_message as string | null) ?? null,
  }))

  return {
    providers,
    sessions,
    totals,
    alerts: providers.flatMap((p) => p.alerts),
    poolEnabled: process.env.BROWSER_POOL_ENABLED === "true",
  }
}
