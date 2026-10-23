import { randomUUID } from "node:crypto"

import { requestJson } from "./http.js"
import {
  ProviderError,
  type BrowserProviderAdapter,
  type CloudSession,
  type CreateSessionOptions,
  type FetchLike,
  type ProviderSecrets,
  type ProviderType,
  type SessionUsage,
} from "./types.js"

type AdapterDeps = { fetch?: FetchLike; endpoints?: Partial<Record<string, string>> }

const defaultFetch: FetchLike = (input, init) => fetch(input, init)

/**
 * Browserless v2: no REST session, the WebSocket connection IS the session.
 * Live view comes from the CDP command `Browserless.liveURL` once a page is open.
 * 1 unit = 30 s of browser time.
 */
export function browserlessAdapter(
  secrets: ProviderSecrets,
  deps: AdapterDeps = {}
): BrowserProviderAdapter {
  const base = (deps.endpoints?.browserless ?? "wss://production-sfo.browserless.io").replace(/\/$/, "")
  return {
    type: "browserless",
    async createSession(options: CreateSessionOptions): Promise<CloudSession> {
      const params = new URLSearchParams({
        token: secrets.apiKey,
        timeout: String(options.timeoutSeconds * 1000),
      })
      if (options.headful) params.set("headless", "false")
      return {
        externalId: `bl-${randomUUID()}`,
        cdpUrl: `${base}/chromium?${params.toString()}`,
        liveViewUrl: null,
      }
    },
    async closeSession() {
      // Closing the CDP connection ends the Browserless session.
    },
    async liveViewFromCdp(send) {
      const result = (await send("Browserless.liveURL", {
        timeout: 600_000,
        interactable: true,
      })) as { liveURL?: string } | undefined
      return result?.liveURL ?? null
    },
  }
}

type SteelSession = {
  id: string
  websocketUrl?: string
  debugUrl?: string
  sessionViewerUrl?: string
  duration?: number
  creditsUsed?: number
}

/** Steel: REST session + `wss://connect.steel.dev?apiKey=&sessionId=`. Max 15 min on free. */
export function steelAdapter(
  secrets: ProviderSecrets,
  deps: AdapterDeps = {}
): BrowserProviderAdapter {
  const f = deps.fetch ?? defaultFetch
  const api = deps.endpoints?.steel ?? "https://api.steel.dev/v1"
  const headers = {
    "steel-api-key": secrets.apiKey,
    "content-type": "application/json",
  }
  return {
    type: "steel",
    async createSession(options) {
      const session = await requestJson<SteelSession>(f, "steel", `${api}/sessions`, {
        method: "POST",
        headers,
        body: JSON.stringify({ timeout: options.timeoutSeconds * 1000 }),
      })
      if (!session?.id) throw new ProviderError("bad_response", "steel: no session id")
      const connect = new URL(deps.endpoints?.steelConnect ?? "wss://connect.steel.dev")
      connect.searchParams.set("apiKey", secrets.apiKey)
      connect.searchParams.set("sessionId", session.id)
      return {
        externalId: session.id,
        cdpUrl: connect.toString(),
        liveViewUrl: session.debugUrl ?? session.sessionViewerUrl ?? null,
      }
    },
    async closeSession(id) {
      await requestJson(f, "steel", `${api}/sessions/${encodeURIComponent(id)}/release`, {
        method: "POST",
        headers,
      })
    },
    async sessionUsage(id): Promise<SessionUsage | null> {
      const session = await requestJson<SteelSession>(
        f,
        "steel",
        `${api}/sessions/${encodeURIComponent(id)}`,
        { headers }
      )
      if (!session) return null
      return {
        durationSeconds:
          typeof session.duration === "number" ? Math.round(session.duration / 1000) : null,
        units: typeof session.creditsUsed === "number" ? session.creditsUsed : null,
      }
    },
  }
}

type KernelBrowser = {
  session_id: string
  cdp_ws_url: string
  browser_live_view_url?: string | null
}

/** Kernel (onkernel.com): POST /browsers returns cdp_ws_url + live view (headful only). */
export function kernelAdapter(
  secrets: ProviderSecrets,
  deps: AdapterDeps = {}
): BrowserProviderAdapter {
  const f = deps.fetch ?? defaultFetch
  const api = deps.endpoints?.kernel ?? "https://api.onkernel.com"
  const headers = {
    authorization: `Bearer ${secrets.apiKey}`,
    "content-type": "application/json",
  }
  return {
    type: "kernel",
    async createSession(options) {
      const browser = await requestJson<KernelBrowser>(f, "kernel", `${api}/browsers`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          headless: !options.headful,
          stealth: true,
          timeout_seconds: options.timeoutSeconds,
        }),
      })
      if (!browser?.session_id || !browser.cdp_ws_url)
        throw new ProviderError("bad_response", "kernel: missing session")
      return {
        externalId: browser.session_id,
        cdpUrl: browser.cdp_ws_url,
        liveViewUrl: browser.browser_live_view_url ?? null,
      }
    },
    async closeSession(id) {
      await requestJson(f, "kernel", `${api}/browsers/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers,
      })
    },
  }
}

type BrowserbaseSession = { id: string; connectUrl: string }

/** Browserbase (disabled by default). */
export function browserbaseAdapter(
  secrets: ProviderSecrets,
  deps: AdapterDeps = {}
): BrowserProviderAdapter {
  const f = deps.fetch ?? defaultFetch
  const api = deps.endpoints?.browserbase ?? "https://api.browserbase.com/v1"
  const headers = { "x-bb-api-key": secrets.apiKey, "content-type": "application/json" }
  if (!secrets.projectId)
    throw new ProviderError("auth", "browserbase: project id env var is empty")
  return {
    type: "browserbase",
    async createSession(options) {
      const session = await requestJson<BrowserbaseSession>(f, "browserbase", `${api}/sessions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          projectId: secrets.projectId,
          timeout: options.timeoutSeconds,
        }),
      })
      if (!session?.id || !session.connectUrl)
        throw new ProviderError("bad_response", "browserbase: missing session")
      let liveViewUrl: string | null = null
      try {
        const debug = await requestJson<{ debuggerFullscreenUrl?: string }>(
          f,
          "browserbase",
          `${api}/sessions/${encodeURIComponent(session.id)}/debug`,
          { headers }
        )
        liveViewUrl = debug?.debuggerFullscreenUrl ?? null
      } catch {
        liveViewUrl = null
      }
      return { externalId: session.id, cdpUrl: session.connectUrl, liveViewUrl }
    },
    async closeSession(id) {
      await requestJson(f, "browserbase", `${api}/sessions/${encodeURIComponent(id)}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ projectId: secrets.projectId, status: "REQUEST_RELEASE" }),
      })
    },
  }
}

type HyperSession = { id: string; wsEndpoint: string; liveUrl?: string | null }

/** Hyperbrowser (disabled by default). */
export function hyperbrowserAdapter(
  secrets: ProviderSecrets,
  deps: AdapterDeps = {}
): BrowserProviderAdapter {
  const f = deps.fetch ?? defaultFetch
  const api = deps.endpoints?.hyperbrowser ?? "https://app.hyperbrowser.ai/api"
  const headers = { "x-api-key": secrets.apiKey, "content-type": "application/json" }
  return {
    type: "hyperbrowser",
    async createSession(options) {
      const session = await requestJson<HyperSession>(f, "hyperbrowser", `${api}/session`, {
        method: "POST",
        headers,
        body: JSON.stringify({ timeoutMinutes: Math.max(1, Math.ceil(options.timeoutSeconds / 60)) }),
      })
      if (!session?.id || !session.wsEndpoint)
        throw new ProviderError("bad_response", "hyperbrowser: missing session")
      return {
        externalId: session.id,
        cdpUrl: session.wsEndpoint,
        liveViewUrl: session.liveUrl ?? null,
      }
    },
    async closeSession(id) {
      await requestJson(f, "hyperbrowser", `${api}/session/${encodeURIComponent(id)}/stop`, {
        method: "PUT",
        headers,
      })
    },
  }
}

export function createAdapter(
  type: ProviderType,
  secrets: ProviderSecrets,
  deps: AdapterDeps = {}
): BrowserProviderAdapter {
  switch (type) {
    case "browserless":
      return browserlessAdapter(secrets, deps)
    case "steel":
      return steelAdapter(secrets, deps)
    case "kernel":
      return kernelAdapter(secrets, deps)
    case "browserbase":
      return browserbaseAdapter(secrets, deps)
    case "hyperbrowser":
      return hyperbrowserAdapter(secrets, deps)
  }
}

/** Reads the secret from the env var NAME stored in the DB. */
export function secretsFromEnv(
  config: { secretEnvVar: string; projectEnvVar: string | null },
  env: Record<string, string | undefined> = process.env
): ProviderSecrets | null {
  const apiKey = env[config.secretEnvVar]?.trim()
  if (!apiKey) return null
  const projectId = config.projectEnvVar ? env[config.projectEnvVar]?.trim() || null : null
  if (config.projectEnvVar && !projectId) return null
  return { apiKey, projectId }
}
