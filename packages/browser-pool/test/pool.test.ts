import { describe, expect, it, vi } from "vitest"

import {
  acquireBrowser,
  MemoryConcurrencyStore,
  PoolExhaustedError,
  providerAlerts,
  ProviderError,
  quotaPeriod,
  quotaStatus,
  rankProviders,
  secretsFromEnv,
  steelAdapter,
  kernelAdapter,
  unitsForDuration,
  type BrowserProviderAdapter,
  type PoolDeps,
  type ProviderConfig,
} from "../src/index.js"

function config(overrides: Partial<ProviderConfig>): ProviderConfig {
  return {
    id: "p1",
    provider: "steel",
    label: "Steel",
    accountEmail: null,
    secretEnvVar: "STEEL_API_KEY",
    projectEnvVar: null,
    enabled: true,
    priority: 10,
    concurrencyLimit: 2,
    maxSessionSeconds: 900,
    quotaKind: "credits_monthly",
    quotaUnit: "USD",
    quotaLimit: 10,
    costPerMinute: 0.01,
    quotaResetDay: 1,
    quotaStartedAt: "2026-10-01T00:00:00Z",
    keyExpiresAt: null,
    alertThreshold: 0.8,
    ...overrides,
  }
}

function fakeAdapter(type: ProviderConfig["provider"], fail?: Error): BrowserProviderAdapter {
  return {
    type,
    createSession: vi.fn(async () => {
      if (fail) throw fail
      return { externalId: `${type}-1`, cdpUrl: `wss://${type}`, liveViewUrl: null }
    }),
    closeSession: vi.fn(async () => undefined),
  }
}

describe("quota", () => {
  it("monthly period resets on the configured day", () => {
    const p = quotaPeriod(config({ quotaResetDay: 23 }), new Date("2026-10-10T00:00:00Z"))
    expect(p.start.toISOString()).toBe("2026-09-23T00:00:00.000Z")
    expect(p.end?.toISOString()).toBe("2026-10-23T00:00:00.000Z")
  })
  it("one-time credits never reset", () => {
    const p = quotaPeriod(config({ quotaKind: "credits_one_time" }))
    expect(p.end).toBeNull()
  })
  it("browserless bills 30 s units with a minimum of one", () => {
    const bl = config({ provider: "browserless", costPerMinute: 2 })
    expect(unitsForDuration(bl, 0)).toBe(1)
    expect(unitsForDuration(bl, 61)).toBe(3)
    expect(unitsForDuration(config({ costPerMinute: 0.5 }), 120)).toBe(1)
  })
  it("levels, projection and alerts", () => {
    const now = new Date("2026-10-16T00:00:00Z")
    const status = quotaStatus(config({}), 8.5, now)
    expect(status.level).toBe("warning")
    expect(status.projectedPercent).toBeGreaterThan(1)
    const alerts = providerAlerts(
      config({ keyExpiresAt: "2026-10-20T00:00:00Z" }),
      status,
      { hasSecret: false, now }
    )
    expect(alerts.map((a) => a.kind).sort()).toEqual(["key_expiring", "missing_secret", "projection", "quota_warning"])
    expect(quotaStatus(config({}), 10, now).level).toBe("exhausted")
  })
})

describe("selector", () => {
  const base = (providers: ProviderConfig[], adapters: Record<string, BrowserProviderAdapter | null>, used: Record<string, number> = {}): PoolDeps => ({
    providers,
    usedUnits: async (c) => used[c.id] ?? 0,
    concurrency: new MemoryConcurrencyStore(),
    adapterFor: (c) => adapters[c.id] ?? null,
    now: () => new Date("2026-10-23T12:00:00Z"),
  })

  it("ranks by priority and skips disabled, expired and exhausted", async () => {
    const providers = [
      config({ id: "a", priority: 20 }),
      config({ id: "b", priority: 10 }),
      config({ id: "c", enabled: false }),
      config({ id: "d", keyExpiresAt: "2026-10-01T00:00:00Z" }),
      config({ id: "e", priority: 1 }),
    ]
    const attempts: never[] = []
    const ranked = await rankProviders(base(providers, {}, { e: 10 }), { timeoutSeconds: 60 }, attempts)
    expect(ranked.map((r) => r.config.id)).toEqual(["b", "a"])
  })

  it("fails over to the next provider and records the failure", async () => {
    const onFailure = vi.fn(async () => undefined)
    const first = fakeAdapter("steel", new ProviderError("quota", "no credits", 402))
    const second = fakeAdapter("kernel")
    const deps = {
      ...base([config({ id: "a", priority: 1 }), config({ id: "b", provider: "kernel", priority: 2 })], { a: first, b: second }),
      onFailure,
    }
    const acquired = await acquireBrowser(deps, { timeoutSeconds: 3600 })
    expect(acquired.config.id).toBe("b")
    expect(acquired.timeoutSeconds).toBe(900)
    expect(onFailure).toHaveBeenCalledOnce()
    await acquired.release()
    await acquired.release()
    expect(second.closeSession).toHaveBeenCalledOnce()
    expect(await deps.concurrency.inUse("a")).toBe(0)
    expect(await deps.concurrency.inUse("b")).toBe(0)
  })

  it("respects concurrency and throws when exhausted", async () => {
    const deps = base([config({ id: "a", concurrencyLimit: 1 })], { a: fakeAdapter("steel") })
    await acquireBrowser(deps, { timeoutSeconds: 60 })
    const error = await acquireBrowser(deps, { timeoutSeconds: 60 }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(PoolExhaustedError)
    expect((error as PoolExhaustedError).attempts[0]?.reason).toBe("concurrency_full")
  })

  it("missing secret is skipped", async () => {
    const error = await acquireBrowser(base([config({ id: "a" })], { a: null }), { timeoutSeconds: 60 }).catch((e: unknown) => e)
    expect((error as PoolExhaustedError).attempts[0]?.reason).toBe("missing_secret")
  })
})

describe("adapters", () => {
  it("secretsFromEnv reads env var names only", () => {
    expect(secretsFromEnv({ secretEnvVar: "X_KEY", projectEnvVar: null }, { X_KEY: " k " })).toEqual({ apiKey: "k", projectId: null })
    expect(secretsFromEnv({ secretEnvVar: "X_KEY", projectEnvVar: "X_PROJ" }, { X_KEY: "k" })).toBeNull()
  })

  it("steel creates, reads usage and releases", async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    const fetch = async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      if (url.endsWith("/sessions")) return Response.json({ id: "s1", debugUrl: "https://live/s1" })
      if (url.endsWith("/release")) return Response.json({ success: true })
      return Response.json({ id: "s1", duration: 90_000, creditsUsed: 0.0025 })
    }
    const adapter = steelAdapter({ apiKey: "secret" }, { fetch })
    const session = await adapter.createSession({ timeoutSeconds: 60 })
    expect(session.liveViewUrl).toBe("https://live/s1")
    expect(session.cdpUrl).toContain("sessionId=s1")
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ timeout: 60_000 })
    expect(await adapter.sessionUsage?.("s1")).toEqual({ durationSeconds: 90, units: 0.0025 })
    await adapter.closeSession("s1")
    expect(calls[2]?.url).toContain("/sessions/s1/release")
  })

  it("maps HTTP errors to provider codes without leaking the key", async () => {
    const fetch = async () => new Response("bad key secret", { status: 401 })
    const error = await kernelAdapter({ apiKey: "secret" }, { fetch })
      .createSession({ timeoutSeconds: 60 })
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ProviderError)
    expect((error as ProviderError).code).toBe("auth")
  })
})
