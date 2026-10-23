import type { ProviderConfig, ProviderType, QuotaKind } from "./types.js"

/** Maps a public.browser_providers row (numeric columns arrive as strings) to ProviderConfig. */
export function providerFromRow(row: Record<string, unknown>): ProviderConfig {
  const num = (v: unknown, fallback = 0) => {
    const n = typeof v === "number" ? v : Number(v)
    return Number.isFinite(n) ? n : fallback
  }
  return {
    id: String(row.id),
    provider: row.provider as ProviderType,
    label: String(row.label ?? row.provider),
    accountEmail: (row.account_email as string | null) ?? null,
    secretEnvVar: String(row.secret_env_var),
    projectEnvVar: (row.project_env_var as string | null) ?? null,
    enabled: Boolean(row.enabled),
    priority: num(row.priority, 100),
    concurrencyLimit: num(row.concurrency_limit, 1),
    maxSessionSeconds: row.max_session_seconds == null ? null : num(row.max_session_seconds),
    quotaKind: row.quota_kind as QuotaKind,
    quotaUnit: String(row.quota_unit ?? "units"),
    quotaLimit: num(row.quota_limit),
    costPerMinute: num(row.cost_per_minute),
    quotaResetDay: row.quota_reset_day == null ? null : num(row.quota_reset_day),
    quotaStartedAt: String(row.quota_started_at ?? new Date(0).toISOString()),
    keyExpiresAt: (row.key_expires_at as string | null) ?? null,
    alertThreshold: num(row.alert_threshold, 0.8),
  }
}

export const PROVIDER_COLUMNS =
  "id, provider, label, account_email, secret_env_var, project_env_var, enabled, priority, concurrency_limit, max_session_seconds, quota_kind, quota_unit, quota_limit, cost_per_minute, quota_reset_day, quota_started_at, key_expires_at, alert_threshold"
