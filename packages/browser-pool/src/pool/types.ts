export const PROVIDER_TYPES = [
  "browserless",
  "steel",
  "kernel",
  "browserbase",
  "hyperbrowser",
] as const
export type ProviderType = (typeof PROVIDER_TYPES)[number]

export type QuotaKind = "units_monthly" | "credits_monthly" | "credits_one_time"

/** Row of public.browser_providers (camelCase). Holds env var NAMES, never secrets. */
export type ProviderConfig = {
  id: string
  provider: ProviderType
  label: string
  accountEmail: string | null
  secretEnvVar: string
  projectEnvVar: string | null
  enabled: boolean
  priority: number
  concurrencyLimit: number
  maxSessionSeconds: number | null
  quotaKind: QuotaKind
  quotaUnit: string
  quotaLimit: number
  costPerMinute: number
  quotaResetDay: number | null
  quotaStartedAt: string
  keyExpiresAt: string | null
  alertThreshold: number
}

export type ProviderSecrets = { apiKey: string; projectId?: string | null }

export type CreateSessionOptions = {
  /** Hard stop requested from the provider; capped by maxSessionSeconds. */
  timeoutSeconds: number
  /** Headful sessions give a human-usable live view (login, captcha, 2FA). */
  headful?: boolean
}

export type CloudSession = {
  externalId: string
  /** CDP WebSocket URL. May embed the API key: never log or persist it. */
  cdpUrl: string
  liveViewUrl: string | null
}

export type SessionUsage = { durationSeconds: number | null; units: number | null }

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface BrowserProviderAdapter {
  readonly type: ProviderType
  createSession(options: CreateSessionOptions): Promise<CloudSession>
  closeSession(externalId: string): Promise<void>
  /** Real usage reported by the provider for one session, when it exposes it. */
  sessionUsage?(externalId: string): Promise<SessionUsage | null>
  /**
   * Some providers (Browserless) only hand out a live view through a CDP command on a page.
   * `send` is a CDP session bound to the page the user should see.
   */
  liveViewFromCdp?(
    send: (method: string, params?: Record<string, unknown>) => Promise<unknown>
  ): Promise<string | null>
}

export class ProviderError extends Error {
  constructor(
    readonly code:
      | "auth"
      | "quota"
      | "concurrency"
      | "unavailable"
      | "bad_response"
      | "timeout",
    message: string,
    readonly status?: number
  ) {
    super(message)
    this.name = "ProviderError"
  }
}
