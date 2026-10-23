import type { ProviderConfig } from "./types.js"

export type QuotaPeriod = { start: Date; end: Date | null }

function clampDay(year: number, month: number, day: number): Date {
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return new Date(Date.UTC(year, month, Math.min(day, last)))
}

/**
 * Current quota window. Monthly quotas reset on `quotaResetDay` (1 = calendar month, i.e. "end of
 * month"); one-time credits never reset and count from `quotaStartedAt`. UTC dates.
 */
export function quotaPeriod(
  config: Pick<ProviderConfig, "quotaKind" | "quotaResetDay" | "quotaStartedAt">,
  now: Date = new Date()
): QuotaPeriod {
  if (config.quotaKind === "credits_one_time") {
    return { start: new Date(config.quotaStartedAt), end: null }
  }
  const day = config.quotaResetDay ?? 1
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth()
  let start = clampDay(y, m, day)
  if (start.getTime() > now.getTime()) start = clampDay(y, m - 1, day)
  const end = clampDay(start.getUTCFullYear(), start.getUTCMonth() + 1, day)
  return { start, end }
}

/** Units a session consumes, from its duration and the provider's per-minute cost. */
export function unitsForDuration(
  config: Pick<ProviderConfig, "provider" | "costPerMinute">,
  durationSeconds: number
): number {
  const seconds = Math.max(0, durationSeconds)
  if (config.provider === "browserless") {
    // Browserless bills whole 30 s units (minimum 1 per session).
    return Math.max(1, Math.ceil(seconds / 30))
  }
  return roundUnits((seconds / 60) * config.costPerMinute)
}

export function roundUnits(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

export type QuotaStatus = {
  used: number
  limit: number
  remaining: number
  percent: number
  projected: number | null
  projectedPercent: number | null
  period: QuotaPeriod
  level: "ok" | "warning" | "critical" | "exhausted"
}

export function quotaStatus(
  config: Pick<
    ProviderConfig,
    "quotaKind" | "quotaResetDay" | "quotaStartedAt" | "quotaLimit" | "alertThreshold"
  >,
  used: number,
  now: Date = new Date()
): QuotaStatus {
  const period = quotaPeriod(config, now)
  const limit = Math.max(0, config.quotaLimit)
  const remaining = roundUnits(Math.max(0, limit - used))
  const percent = limit > 0 ? used / limit : 1
  let projected: number | null = null
  if (period.end) {
    const total = period.end.getTime() - period.start.getTime()
    const elapsed = Math.max(now.getTime() - period.start.getTime(), 3_600_000)
    projected = roundUnits((used / elapsed) * total)
  }
  const level =
    remaining <= 0
      ? "exhausted"
      : percent >= Math.max(config.alertThreshold, 0.95)
        ? "critical"
        : percent >= config.alertThreshold
          ? "warning"
          : "ok"
  return {
    used: roundUnits(used),
    limit,
    remaining,
    percent,
    projected,
    projectedPercent: projected !== null && limit > 0 ? projected / limit : null,
    period,
    level,
  }
}

export type ProviderAlert = {
  providerId: string
  label: string
  kind: "quota_warning" | "quota_critical" | "quota_exhausted" | "projection" | "key_expiring" | "key_expired" | "missing_secret"
  message: string
}

export function providerAlerts(
  config: Pick<ProviderConfig, "id" | "label" | "keyExpiresAt" | "enabled">,
  status: QuotaStatus,
  options: { hasSecret: boolean; now?: Date; expiryWarningDays?: number } = { hasSecret: true }
): ProviderAlert[] {
  const now = options.now ?? new Date()
  const alerts: ProviderAlert[] = []
  const base = { providerId: config.id, label: config.label }
  const pct = Math.round(status.percent * 100)
  if (status.level === "exhausted")
    alerts.push({ ...base, kind: "quota_exhausted", message: `Cota esgotada (${pct}%).` })
  else if (status.level === "critical")
    alerts.push({ ...base, kind: "quota_critical", message: `Cota quase no fim (${pct}%).` })
  else if (status.level === "warning")
    alerts.push({ ...base, kind: "quota_warning", message: `Cota em ${pct}%.` })
  if (status.level !== "exhausted" && status.projectedPercent !== null && status.projectedPercent > 1)
    alerts.push({
      ...base,
      kind: "projection",
      message: `No ritmo atual a cota acaba antes da renovação (${Math.round(status.projectedPercent * 100)}% projetado).`,
    })
  if (config.keyExpiresAt) {
    const days = (new Date(config.keyExpiresAt).getTime() - now.getTime()) / 86_400_000
    if (days <= 0) alerts.push({ ...base, kind: "key_expired", message: "Chave expirada." })
    else if (days <= (options.expiryWarningDays ?? 7))
      alerts.push({ ...base, kind: "key_expiring", message: `Chave expira em ${Math.ceil(days)} dia(s).` })
  }
  if (config.enabled && !options.hasSecret)
    alerts.push({ ...base, kind: "missing_secret", message: "Variável de ambiente da chave ausente." })
  return alerts
}
