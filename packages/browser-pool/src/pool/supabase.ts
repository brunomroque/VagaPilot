import type { SupabaseClient } from "@supabase/supabase-js"

import { createAdapter, secretsFromEnv } from "./adapters.js"
import {
  concurrencyStoreFromEnv,
  type ConcurrencyStore,
} from "./concurrency.js"
import { PROVIDER_COLUMNS, providerFromRow } from "./db.js"
import { scrub } from "./http.js"
import {
  acquireLocalBrowser,
  browserProviderFromEnv,
  cloudFallbackEnabled,
  LOCAL_PROVIDER_ID,
  localCdpUrlFromEnv,
  probeLocalBrowser,
} from "./local.js"
import { quotaPeriod, roundUnits, unitsForDuration } from "./quota.js"
import {
  acquireBrowser,
  type AcquireOptions,
  type AcquiredBrowser,
  type PoolDeps,
} from "./selector.js"
import {
  ProviderError,
  type BrowserProviderAdapter,
  type FetchLike,
  type ProviderConfig,
} from "./types.js"

type Env = Record<string, string | undefined>

export async function loadProviders(
  admin: SupabaseClient
): Promise<ProviderConfig[]> {
  const { data, error } = await admin
    .from("browser_providers")
    .select(PROVIDER_COLUMNS)
    .order("priority", { ascending: true })
  if (error) throw new Error(`browser_providers: ${error.message}`)
  return ((data ?? []) as Record<string, unknown>[]).map(providerFromRow)
}

/** Sum of units recorded in the provider's current period. */
export async function usedUnitsFromDb(
  client: SupabaseClient,
  config: ProviderConfig,
  now: Date = new Date()
): Promise<number> {
  const period = quotaPeriod(config, now)
  const { data, error } = await client
    .from("browser_sessions")
    .select("units_used")
    .eq("provider_id", config.id)
    .gte("started_at", period.start.toISOString())
    .limit(10_000)
  if (error) throw new Error(`browser_sessions: ${error.message}`)
  return roundUnits(
    ((data ?? []) as { units_used: number | string }[]).reduce(
      (sum, row) => sum + Number(row.units_used ?? 0),
      0
    )
  )
}

export type PoolRuntime = {
  admin: SupabaseClient
  env?: Env
  fetch?: FetchLike
  concurrency?: ConcurrencyStore
  /** Overrides adapters entirely (tests / local mock provider). */
  adapterFor?: (config: ProviderConfig) => BrowserProviderAdapter | null
}

export function isPoolEnabled(env: Env = process.env): boolean {
  return env.BROWSER_POOL_ENABLED === "true"
}

export async function buildPoolDeps(runtime: PoolRuntime): Promise<PoolDeps> {
  const env = runtime.env ?? process.env
  const providers = await loadProviders(runtime.admin)
  return {
    providers,
    usedUnits: (config) => usedUnitsFromDb(runtime.admin, config),
    concurrency: runtime.concurrency ?? (await concurrencyStoreFromEnv(env)),
    adapterFor:
      runtime.adapterFor ??
      ((config) => {
        const secrets = secretsFromEnv(config, env)
        if (!secrets) return null
        try {
          return createAdapter(config.provider, secrets, {
            fetch: runtime.fetch,
          })
        } catch {
          return null
        }
      }),
  }
}

export type TrackedBrowser = AcquiredBrowser & {
  sessionRowId: string | null
  /** Releases the browser and writes duration/units to browser_sessions. */
  finish(error?: { code: string; message: string }): Promise<void>
}

/** acquireBrowser + browser_sessions bookkeeping. */
export async function acquireTrackedBrowser(
  runtime: PoolRuntime,
  options: AcquireOptions & {
    userId: string | null
    applyRunId?: string | null
    purpose?: "apply" | "test" | "login"
  }
): Promise<TrackedBrowser> {
  // Primary: the user's own Chrome (remote debugging). Fallback: cloud pool, Browserbase first.
  const env = runtime.env ?? process.env
  if (browserProviderFromEnv(env) === "local") {
    const canProbeLocal =
      !options.exclude?.includes(LOCAL_PROVIDER_ID) &&
      (!runtime.adapterFor ||
        Boolean(runtime.fetch) ||
        Boolean(env.LOCAL_BROWSER_CDP_URL))
    if (canProbeLocal) {
      const ws = await probeLocalBrowser(localCdpUrlFromEnv(env), runtime.fetch)
      if (ws) {
        const local = acquireLocalBrowser(ws, options.timeoutSeconds)
        return {
          ...local,
          sessionRowId: null,
          async finish() {
            await local.release()
          },
        }
      }
    }
    if (!cloudFallbackEnabled(env))
      throw new ProviderError(
        "unavailable",
        "Navegador local indisponivel: abra o Chrome com --remote-debugging-port (BROWSER_FALLBACK=none)."
      )
  }
  options = { ...options, prefer: options.prefer ?? ["browserbase"] }
  const deps = await buildPoolDeps(runtime)
  deps.onFailure = async (config, error) => {
    await runtime.admin.from("browser_sessions").insert({
      provider_id: config.id,
      provider: config.provider,
      user_id: options.userId,
      apply_run_id: options.applyRunId ?? null,
      status: "falhou",
      purpose: options.purpose ?? "apply",
      ended_at: new Date().toISOString(),
      duration_seconds: 0,
      units_used: 0,
      error_code: error instanceof ProviderError ? error.code : "error",
      error_message:
        error instanceof Error ? scrub(error.message).slice(0, 300) : null,
    })
  }
  const acquired = await acquireBrowser(deps, options)
  const startedAt = new Date()
  const inserted = await runtime.admin
    .from("browser_sessions")
    .insert({
      provider_id: acquired.config.id,
      provider: acquired.config.provider,
      user_id: options.userId,
      apply_run_id: options.applyRunId ?? null,
      external_id: acquired.session.externalId,
      status: "ativa",
      purpose: options.purpose ?? "apply",
      started_at: startedAt.toISOString(),
    })
    .select("id")
    .single()
  const sessionRowId = (inserted.data as { id: string } | null)?.id ?? null
  let finished = false
  return {
    ...acquired,
    sessionRowId,
    async finish(error) {
      if (finished) return
      finished = true
      await acquired.release()
      const endedAt = new Date()
      let durationSeconds = Math.round(
        (endedAt.getTime() - startedAt.getTime()) / 1000
      )
      let units = unitsForDuration(acquired.config, durationSeconds)
      try {
        const usage = await acquired.adapter.sessionUsage?.(
          acquired.session.externalId
        )
        if (usage?.durationSeconds != null && usage.durationSeconds > 0)
          durationSeconds = usage.durationSeconds
        if (usage?.units != null && usage.units > 0) units = usage.units
        else if (usage?.durationSeconds)
          units = unitsForDuration(acquired.config, durationSeconds)
      } catch {
        // Estimated from wall-clock time.
      }
      if (!sessionRowId) return
      await runtime.admin
        .from("browser_sessions")
        .update({
          status: error ? "falhou" : "encerrada",
          ended_at: endedAt.toISOString(),
          duration_seconds: durationSeconds,
          units_used: units,
          error_code: error?.code ?? null,
          error_message: error ? scrub(error.message).slice(0, 300) : null,
        })
        .eq("id", sessionRowId)
    },
  }
}

export type ProviderTestResult = {
  ok: boolean
  latencyMs: number
  message: string
  liveView: boolean
}

/** "Testar conexão": opens and closes a short headless session on ONE provider. */
export async function testProviderConnection(
  runtime: PoolRuntime,
  config: ProviderConfig,
  connect?: (cdpUrl: string) => Promise<void>
): Promise<ProviderTestResult> {
  const env = runtime.env ?? process.env
  const secrets = secretsFromEnv(config, env)
  const started = Date.now()
  if (!secrets) {
    return {
      ok: false,
      latencyMs: 0,
      message: `Env var ${config.secretEnvVar} vazia neste ambiente.`,
      liveView: false,
    }
  }
  let result: ProviderTestResult
  const startedAt = new Date()
  let externalId: string | null = null
  let adapter: BrowserProviderAdapter | null = null
  try {
    adapter =
      runtime.adapterFor?.(config) ??
      createAdapter(config.provider, secrets, { fetch: runtime.fetch })
    const session = await adapter.createSession({ timeoutSeconds: 60 })
    externalId = session.externalId
    if (connect) await connect(session.cdpUrl)
    result = {
      ok: true,
      latencyMs: Date.now() - started,
      message: connect ? "Sessão criada e CDP conectado." : "Sessão criada.",
      liveView:
        Boolean(session.liveViewUrl) || Boolean(adapter.liveViewFromCdp),
    }
  } catch (error) {
    result = {
      ok: false,
      latencyMs: Date.now() - started,
      message:
        error instanceof Error ? scrub(error.message).slice(0, 300) : "Falhou.",
      liveView: false,
    }
  } finally {
    if (adapter && externalId)
      await adapter.closeSession(externalId).catch(() => undefined)
  }
  const durationSeconds = Math.round((Date.now() - startedAt.getTime()) / 1000)
  await runtime.admin.from("browser_sessions").insert({
    provider_id: config.id,
    provider: config.provider,
    user_id: null,
    external_id: externalId,
    status: result.ok ? "encerrada" : "falhou",
    purpose: "test",
    started_at: startedAt.toISOString(),
    ended_at: new Date().toISOString(),
    duration_seconds: durationSeconds,
    units_used: externalId ? unitsForDuration(config, durationSeconds) : 0,
    error_message: result.ok ? null : result.message,
  })
  await runtime.admin
    .from("browser_providers")
    .update({
      last_test_at: new Date().toISOString(),
      last_test_ok: result.ok,
      last_test_message: result.message,
    })
    .eq("id", config.id)
  return result
}
