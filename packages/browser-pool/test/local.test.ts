import { describe, expect, it } from "vitest"

import {
  acquireLocalBrowser,
  acquireTrackedBrowser,
  browserProviderFromEnv,
  cloudFallbackEnabled,
  localCdpUrlFromEnv,
  probeLocalBrowser,
} from "../src/index.js"
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
  it("defaults to local with cloud fallback", () => {
    expect(browserProviderFromEnv({})).toBe("local")
    expect(browserProviderFromEnv({ BROWSER_PROVIDER: "browserbase" })).toBe(
      "browserbase"
    )
    expect(cloudFallbackEnabled({})).toBe(true)
    expect(cloudFallbackEnabled({ BROWSER_FALLBACK: "none" })).toBe(false)
    expect(localCdpUrlFromEnv({})).toBe("http://127.0.0.1:9222")
  })

  it("probes /json/version", async () => {
    const ok = await probeLocalBrowser(
      "http://127.0.0.1:9222",
      async () =>
        new Response(
          JSON.stringify({
            webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/x",
          })
        )
    )
    expect(ok).toBe("ws://127.0.0.1:9222/devtools/browser/x")
    const down = await probeLocalBrowser("http://127.0.0.1:9222", async () => {
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

  it("uses local as primary and falls back to Browserbase when local is unreachable", async () => {
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

    // 1. Local responds -> returns local without recording browser_sessions
    const trackedLocal = await acquireTrackedBrowser(
      {
        admin: client,
        env: {},
        fetch: async () =>
          new Response(
            JSON.stringify({
              webSocketDebuggerUrl:
                "ws://127.0.0.1:9222/devtools/browser/local",
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

    // 2. Local unreachable -> falls back to Browserbase (even though Steel has priority 10)
    const trackedFallback = await acquireTrackedBrowser(
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
    expect(trackedFallback.config.provider).toBe("browserbase")
    expect(trackedFallback.sessionRowId).toBeTruthy()
    await trackedFallback.finish()

    // 3. Mid-run failover (exclude: ["local"]) also prefers Browserbase
    const trackedFailover = await acquireTrackedBrowser(
      {
        admin: client,
        env: {},
        fetch: async () =>
          new Response(
            JSON.stringify({
              webSocketDebuggerUrl:
                "ws://127.0.0.1:9222/devtools/browser/local",
            })
          ),
        adapterFor,
      },
      { timeoutSeconds: 60, userId: "u1", exclude: ["local"] }
    )
    expect(trackedFailover.config.provider).toBe("browserbase")
    await trackedFailover.finish()

    // 4. BROWSER_FALLBACK=none throws when local is down
    await expect(
      acquireTrackedBrowser(
        {
          admin: client,
          env: { BROWSER_FALLBACK: "none" },
          fetch: async () => {
            throw new Error("ECONNREFUSED")
          },
          adapterFor,
        },
        { timeoutSeconds: 60, userId: "u1" }
      )
    ).rejects.toThrow(/BROWSER_FALLBACK=none/)
  })
})
