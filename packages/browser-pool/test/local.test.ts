import { describe, expect, it } from "vitest"

import {
  acquireLocalBrowser,
  acquireTrackedBrowser,
  browserProviderFromEnv,
  DEFAULT_LOCAL_CHROME_PROFILE,
  DEFAULT_LOCAL_CDP_URL,
  localCdpUrlFromEnv,
  localChromeProfileFromEnv,
  localChromeUnavailableMessage,
  probeLocalBrowser,
} from "../src/index.js"
import { ProviderError } from "../src/pool/types.js"
import { fakeSupabase } from "./fake-supabase.js"

const providerRows = [
  {
    id: "p-steel",
    provider: "steel",
    label: "Steel",
    account_email: null,
    secret_env_var: "STEEL_API_KEY",
    project_env_var: null,
    enabled: true,
    priority: 10,
    concurrency_limit: 2,
    max_session_seconds: 900,
    quota_kind: "credits_monthly",
    quota_unit: "USD",
    quota_limit: 10,
    cost_per_minute: 0.01,
    quota_reset_day: 1,
    quota_started_at: "2026-10-01T00:00:00Z",
    key_expires_at: null,
    alert_threshold: 0.8,
  },
  {
    id: "p-bb",
    provider: "browserbase",
    label: "Browserbase",
    account_email: null,
    secret_env_var: "BROWSERBASE_API_KEY",
    project_env_var: "BROWSERBASE_PROJECT_ID",
    enabled: true,
    priority: 40,
    concurrency_limit: 2,
    max_session_seconds: 900,
    quota_kind: "units_monthly",
    quota_unit: "min",
    quota_limit: 60,
    cost_per_minute: 1,
    quota_reset_day: 1,
    quota_started_at: "2026-10-01T00:00:00Z",
    key_expires_at: null,
    alert_threshold: 0.8,
  },
]

describe("local browser provider", () => {
  it("defaults to local CDP 9223 and chrome-vagas profile", () => {
    expect(browserProviderFromEnv({})).toBe("local")
    expect(browserProviderFromEnv({ BROWSER_PROVIDER: "browserbase" })).toBe(
      "browserbase"
    )
    expect(localCdpUrlFromEnv({})).toBe(DEFAULT_LOCAL_CDP_URL)
    expect(DEFAULT_LOCAL_CDP_URL).toBe("http://127.0.0.1:9223")
    expect(localChromeProfileFromEnv({})).toBe(DEFAULT_LOCAL_CHROME_PROFILE)
    expect(
      localChromeUnavailableMessage("http://127.0.0.1:9223", {})
    ).toContain("9223")
    expect(
      localChromeUnavailableMessage("http://127.0.0.1:9223", {})
    ).toContain(DEFAULT_LOCAL_CHROME_PROFILE)
  })

  it("probes /json/version", async () => {
    const ok = await probeLocalBrowser(
      DEFAULT_LOCAL_CDP_URL,
      async () =>
        new Response(
          JSON.stringify({
            webSocketDebuggerUrl: "ws://127.0.0.1:9223/devtools/browser/x",
          })
        )
    )
    expect(ok).toBe("ws://127.0.0.1:9223/devtools/browser/x")
    const down = await probeLocalBrowser(DEFAULT_LOCAL_CDP_URL, async () => {
      throw new Error("ECONNREFUSED")
    })
    expect(down).toBeNull()
  })

  it("never closes the user's Chrome", async () => {
    const acquired = acquireLocalBrowser("ws://x", 60)
    expect(acquired.config.id).toBe("local")
    await expect(acquired.release()).resolves.toBeUndefined()
    await expect(acquired.adapter.closeSession("x")).resolves.toBeUndefined()
  })

  it("uses local when reachable and never falls back to Browserbase", async () => {
    const { client, db } = fakeSupabase({
      browser_providers: providerRows.map((r) => ({ ...r })),
    })
    const adapterFor = (config: { provider: string }) => ({
      type: config.provider as "browserbase" | "steel",
      async createSession() {
        return {
          externalId: `${config.provider}-ext`,
          cdpUrl: `wss://${config.provider}`,
          liveViewUrl: null,
        }
      },
      async closeSession() {},
    })

    const trackedLocal = await acquireTrackedBrowser(
      {
        admin: client,
        env: {},
        fetch: async () =>
          new Response(
            JSON.stringify({
              webSocketDebuggerUrl:
                "ws://127.0.0.1:9223/devtools/browser/local",
            })
          ),
        adapterFor,
      },
      { timeoutSeconds: 60, userId: "u1" }
    )
    expect(trackedLocal.config.id).toBe("local")
    expect(trackedLocal.sessionRowId).toBeNull()
    await trackedLocal.finish()
    expect(db.browser_sessions ?? []).toHaveLength(0)

    await expect(
      acquireTrackedBrowser(
        {
          admin: client,
          env: {},
          fetch: async () => {
            throw new Error("ECONNREFUSED")
          },
          adapterFor,
        },
        { timeoutSeconds: 60, userId: "u1" }
      )
    ).rejects.toMatchObject({
      code: "unavailable",
    } as Partial<ProviderError>)

    await expect(
      acquireTrackedBrowser(
        {
          admin: client,
          env: {},
          fetch: async () => {
            throw new Error("ECONNREFUSED")
          },
          adapterFor,
        },
        { timeoutSeconds: 60, userId: "u1" }
      )
    ).rejects.toThrow(/Chrome local indisponível/)
  })

  it("with exclude local uses cloud pool when BROWSER_PROVIDER=browserbase", async () => {
    const { client } = fakeSupabase({
      browser_providers: providerRows.map((r) => ({ ...r })),
    })
    const adapterFor = (config: { provider: string }) => ({
      type: config.provider as "browserbase" | "steel",
      async createSession() {
        return {
          externalId: `${config.provider}-ext`,
          cdpUrl: `wss://${config.provider}`,
          liveViewUrl: null,
        }
      },
      async closeSession() {},
    })
    const tracked = await acquireTrackedBrowser(
      {
        admin: client,
        env: { BROWSER_PROVIDER: "browserbase", BROWSER_POOL_ENABLED: "true" },
        fetch: async () =>
          new Response(
            JSON.stringify({
              webSocketDebuggerUrl:
                "ws://127.0.0.1:9223/devtools/browser/local",
            })
          ),
        adapterFor,
      },
      { timeoutSeconds: 60, userId: "u1" }
    )
    expect(tracked.config.provider).toBe("browserbase")
    await tracked.finish()
  })
})
