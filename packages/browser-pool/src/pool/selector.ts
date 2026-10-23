import type { ConcurrencyStore } from "./concurrency.js"
import { quotaStatus, unitsForDuration } from "./quota.js"
import {
  ProviderError,
  type BrowserProviderAdapter,
  type CloudSession,
  type CreateSessionOptions,
  type ProviderConfig,
  type ProviderType,
} from "./types.js"

export type SkipReason =
  | "disabled"
  | "key_expired"
  | "missing_secret"
  | "quota_exhausted"
  | "concurrency_full"
  | "excluded"

export type Attempt = {
  providerId: string
  provider: string
  outcome: "skipped" | "failed" | "ok"
  reason?: SkipReason | ProviderError["code"] | "error"
  message?: string
}

export type PoolDeps = {
  providers: ProviderConfig[]
  /** Units already used in the provider's current quota period. */
  usedUnits(config: ProviderConfig): Promise<number>
  concurrency: ConcurrencyStore
  /** Returns null when the env var named in the config is empty. */
  adapterFor(config: ProviderConfig): BrowserProviderAdapter | null
  onFailure?(config: ProviderConfig, error: unknown): Promise<void>
  now?: () => Date
}

export type AcquireOptions = CreateSessionOptions & {
  exclude?: string[]
  /** Provider types to try first, in order (e.g. live-view friendly ones for logins). */
  prefer?: ProviderType[]
  /** Runs after a provider is picked, before its session is created (e.g. native persistence). */
  beforeCreate?(
    config: ProviderConfig,
    adapter: BrowserProviderAdapter
  ): Promise<Partial<CreateSessionOptions> | void>
}

export type AcquiredBrowser = {
  config: ProviderConfig
  adapter: BrowserProviderAdapter
  session: CloudSession
  /** Effective timeout after capping by the provider max. */
  timeoutSeconds: number
  attempts: Attempt[]
  /** Frees the concurrency slot and closes the remote session (idempotent). */
  release(): Promise<void>
}

export class PoolExhaustedError extends Error {
  constructor(readonly attempts: Attempt[]) {
    super(
      `No cloud browser available: ${attempts
        .map((a) => `${a.provider}=${a.reason ?? a.outcome}`)
        .join(", ")}`
    )
    this.name = "PoolExhaustedError"
  }
}

type Candidate = { config: ProviderConfig; remainingRatio: number }

/** Orders eligible providers: priority asc, then most remaining quota. */
export async function rankProviders(
  deps: PoolDeps,
  options: AcquireOptions,
  attempts: Attempt[]
): Promise<Candidate[]> {
  const now = deps.now?.() ?? new Date()
  const candidates: Candidate[] = []
  for (const config of deps.providers) {
    const skip = (reason: SkipReason) =>
      attempts.push({
        providerId: config.id,
        provider: config.provider,
        outcome: "skipped",
        reason,
      })
    if (!config.enabled) {
      skip("disabled")
      continue
    }
    if (options.exclude?.includes(config.id)) {
      skip("excluded")
      continue
    }
    if (
      config.keyExpiresAt &&
      new Date(config.keyExpiresAt).getTime() <= now.getTime()
    ) {
      skip("key_expired")
      continue
    }
    const used = await deps.usedUnits(config)
    const status = quotaStatus(config, used, now)
    // Need room for at least one minute of browser time.
    if (status.remaining < unitsForDuration(config, 60)) {
      skip("quota_exhausted")
      continue
    }
    candidates.push({
      config,
      remainingRatio: status.limit > 0 ? status.remaining / status.limit : 0,
    })
  }
  const rank = (type: ProviderType) => {
    const index = options.prefer?.indexOf(type) ?? -1
    return index === -1 ? Number.MAX_SAFE_INTEGER : index
  }
  return candidates.sort(
    (a, b) =>
      rank(a.config.provider) - rank(b.config.provider) ||
      a.config.priority - b.config.priority ||
      b.remainingRatio - a.remainingRatio
  )
}

/** Picks a provider and opens a session, failing over to the next one on any error. */
export async function acquireBrowser(
  deps: PoolDeps,
  options: AcquireOptions
): Promise<AcquiredBrowser> {
  const attempts: Attempt[] = []
  const ranked = await rankProviders(deps, options, attempts)
  for (const { config } of ranked) {
    const adapter = deps.adapterFor(config)
    if (!adapter) {
      attempts.push({
        providerId: config.id,
        provider: config.provider,
        outcome: "skipped",
        reason: "missing_secret",
      })
      continue
    }
    const timeoutSeconds = Math.max(
      30,
      Math.min(
        options.timeoutSeconds,
        config.maxSessionSeconds ?? options.timeoutSeconds
      )
    )
    const gotSlot = await deps.concurrency.tryAcquire(
      config.id,
      config.concurrencyLimit,
      timeoutSeconds + 120
    )
    if (!gotSlot) {
      attempts.push({
        providerId: config.id,
        provider: config.provider,
        outcome: "skipped",
        reason: "concurrency_full",
      })
      continue
    }
    try {
      const extra = (await options.beforeCreate?.(config, adapter)) ?? {}
      const session = await adapter.createSession({
        ...options,
        ...extra,
        timeoutSeconds,
      })
      attempts.push({
        providerId: config.id,
        provider: config.provider,
        outcome: "ok",
      })
      let released = false
      return {
        config,
        adapter,
        session,
        timeoutSeconds,
        attempts,
        async release() {
          if (released) return
          released = true
          try {
            await adapter.closeSession(session.externalId)
          } catch {
            // The provider timeout closes it anyway.
          } finally {
            await deps.concurrency.release(config.id)
          }
        },
      }
    } catch (error) {
      await deps.concurrency.release(config.id)
      attempts.push({
        providerId: config.id,
        provider: config.provider,
        outcome: "failed",
        reason: error instanceof ProviderError ? error.code : "error",
        message:
          error instanceof Error ? error.message.slice(0, 200) : undefined,
      })
      await deps.onFailure?.(config, error)
    }
  }
  throw new PoolExhaustedError(attempts)
}
