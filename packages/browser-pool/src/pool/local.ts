import {
  ProviderError,
  type FetchLike,
  type ProviderConfig,
  type ProviderType,
} from "./types.js"
import type { AcquiredBrowser } from "./selector.js"

type Env = Record<string, string | undefined>

/**
 * Where the automation browser runs.
 * - `local` (default): the user's own Chrome, started with `--remote-debugging-port` on the
 *   machine that runs the worker. Real IP, real fingerprint, real profile: lower chance of
 *   bot detection than a datacenter browser, but it acts on the user's REAL accounts.
 * - `browserbase`: cloud browser pool (Browserbase first). Used directly, or as automatic
 *   fallback when the local browser is unreachable.
 */
export type BrowserProviderMode = "local" | "browserbase"

export const LOCAL_PROVIDER_ID = "local"
export const DEFAULT_LOCAL_CDP_URL = "http://127.0.0.1:9222"

export function browserProviderFromEnv(
  env: Env = process.env
): BrowserProviderMode {
  return env.BROWSER_PROVIDER?.trim().toLowerCase() === "browserbase"
    ? "browserbase"
    : "local"
}

/** Fallback to the cloud pool is on unless BROWSER_FALLBACK=none. */
export function cloudFallbackEnabled(env: Env = process.env): boolean {
  return env.BROWSER_FALLBACK?.trim().toLowerCase() !== "none"
}

export function localCdpUrlFromEnv(env: Env = process.env): string {
  return (env.LOCAL_BROWSER_CDP_URL?.trim() || DEFAULT_LOCAL_CDP_URL).replace(
    /\/$/,
    ""
  )
}

/**
 * Probes `GET {cdp}/json/version`. Returns the browser WebSocket URL, or null when the local
 * Chrome is not running with remote debugging (or the worker is not on the user's machine).
 */
export async function probeLocalBrowser(
  cdpUrl: string,
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
  timeoutMs = 2_000
): Promise<string | null> {
  if (/^wss?:\/\//i.test(cdpUrl)) return cdpUrl
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetchImpl(`${cdpUrl}/json/version`, {
      signal: controller.signal,
    })
    if (!res.ok) return null
    const body = (await res.json()) as { webSocketDebuggerUrl?: string }
    return body.webSocketDebuggerUrl ?? null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Synthetic pool entry for the user's local Chrome (never stored in browser_providers). */
export function localProviderConfig(): ProviderConfig {
  return {
    id: LOCAL_PROVIDER_ID,
    provider: "local" as unknown as ProviderType,
    label: "Navegador local (Chrome do usuario)",
    accountEmail: null,
    secretEnvVar: "",
    projectEnvVar: null,
    enabled: true,
    priority: -1,
    concurrencyLimit: 1,
    maxSessionSeconds: null,
    quotaKind: "units_monthly",
    quotaUnit: "min",
    quotaLimit: Number.MAX_SAFE_INTEGER,
    costPerMinute: 0,
    quotaResetDay: null,
    quotaStartedAt: new Date(0).toISOString(),
    keyExpiresAt: null,
    alertThreshold: 1,
  }
}

export function isLocalBrowser(config: Pick<ProviderConfig, "id">): boolean {
  return config.id === LOCAL_PROVIDER_ID
}

/** Wraps the local Chrome as an AcquiredBrowser. Release never closes the user's Chrome. */
export function acquireLocalBrowser(
  wsUrl: string,
  timeoutSeconds: number
): AcquiredBrowser {
  const config = localProviderConfig()
  return {
    config,
    adapter: {
      type: config.provider,
      async createSession() {
        throw new ProviderError(
          "unavailable",
          "local: session is created by the user"
        )
      },
      async closeSession() {
        // Never close the user's own browser.
      },
    },
    session: {
      externalId: `local-${Date.now()}`,
      cdpUrl: wsUrl,
      liveViewUrl: null,
    },
    timeoutSeconds,
    attempts: [
      { providerId: LOCAL_PROVIDER_ID, provider: "local", outcome: "ok" },
    ],
    async release() {
      // Nothing to release: the user's Chrome stays open.
    },
  }
}
