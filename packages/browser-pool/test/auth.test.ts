import { randomBytes } from "node:crypto"

import type { Browser } from "playwright-core"
import { describe, expect, it, vi } from "vitest"

import { runLoginJob } from "../src/auth/login-job.js"
import {
  acquireBrowser,
  authAad,
  authSealerFromEnv,
  authStateKeyFromEnv,
  browserbaseAdapter,
  estimateExpiry,
  filterStateForSite,
  kernelAdapter,
  MemoryConcurrencyStore,
  normalizeLoginUrl,
  openAuthState,
  pickAuthState,
  sealAuthState,
  siteOf,
  type AuthStateRow,
  type BrowserProviderAdapter,
  type ProviderConfig,
  type StorageState,
} from "../src/index.js"
import { fakeSupabase } from "./fake-supabase.js"

const KEY = randomBytes(32).toString("base64")
const env = { AUTH_STATE_ENCRYPTION_KEY: KEY, BROWSER_POOL_ENABLED: "true" }

const cookie = (domain: string, expires = -1) => ({
  name: "sid",
  value: "secret-cookie",
  domain,
  path: "/",
  expires,
  httpOnly: true,
  secure: true,
  sameSite: "Lax" as const,
})

describe("auth state crypto", () => {
  it("round-trips with AES-GCM and refuses another user/site/provider", () => {
    const key = authStateKeyFromEnv(env)!
    const sealed = sealAuthState(key, authAad("u1", "gupy.io", "kernel"), {
      a: 1,
    })
    expect(sealed.toString("utf8")).not.toContain('"a"')
    expect(
      openAuthState(key, authAad("u1", "gupy.io", "kernel"), sealed)
    ).toEqual({ a: 1 })
    expect(() =>
      openAuthState(key, authAad("u2", "gupy.io", "kernel"), sealed)
    ).toThrow()
    expect(() =>
      openAuthState(key, authAad("u1", "inhire.app", "kernel"), sealed)
    ).toThrow()
  })

  it("accepts hex or base64 keys of 32 bytes only", () => {
    expect(
      authStateKeyFromEnv({ AUTH_STATE_ENCRYPTION_KEY: "ab".repeat(32) })
        ?.length
    ).toBe(32)
    expect(() =>
      authStateKeyFromEnv({ AUTH_STATE_ENCRYPTION_KEY: "short" })
    ).toThrow()
    expect(authStateKeyFromEnv({})).toBeNull()
  })

  it("sealer refuses to write without the key and opens legacy rows via the DEK hook", async () => {
    await expect(
      authSealerFromEnv({}).seal("u", "s", "p", { cookies: [], origins: [] })
    ).rejects.toThrow()
    const legacy = authSealerFromEnv({}, async () => ({
      cookies: [cookie("gupy.io")],
    }))
    const opened = await legacy.open("u", "gupy.io", "legacy", "\\x01ff")
    expect(opened?.cookies).toHaveLength(1)
  })
})

describe("auth state helpers", () => {
  it("siteOf keeps BR second-level suffixes", () => {
    expect(siteOf("https://empresa.gupy.io/jobs/1")).toBe("gupy.io")
    expect(siteOf("https://carreiras.empresa.com.br/x")).toBe("empresa.com.br")
    expect(siteOf("https://career8.successfactors.com/login")).toBe(
      "successfactors.com"
    )
  })

  it("normalizes login URLs and blocks private hosts", () => {
    expect(normalizeLoginUrl("empresa.gupy.io")).toBe(
      "https://empresa.gupy.io/"
    )
    expect(normalizeLoginUrl("http://127.0.0.1:3000")).toBeNull()
    expect(normalizeLoginUrl("javascript:alert(1)")).toBeNull()
  })

  it("keeps only the site's cookies and origins", () => {
    const state: StorageState = {
      cookies: [
        cookie(".gupy.io"),
        cookie("login.gupy.io"),
        cookie(".google.com"),
      ],
      origins: [
        { origin: "https://empresa.gupy.io", localStorage: [] },
        { origin: "https://evil.com", localStorage: [] },
      ],
    }
    const filtered = filterStateForSite(state, "gupy.io")
    expect(filtered.cookies.map((c) => c.domain)).toEqual([
      ".gupy.io",
      "login.gupy.io",
    ])
    expect(filtered.origins).toHaveLength(1)
  })

  it("estimates expiry from persistent cookies, 30 days for session cookies, capped at 90", () => {
    const now = new Date("2026-10-23T12:00:00Z")
    expect(
      estimateExpiry({ cookies: [cookie("a")], origins: [] }, now).toISOString()
    ).toBe("2026-11-22T12:00:00.000Z")
    const in5d = now.getTime() / 1000 + 5 * 86_400
    expect(
      estimateExpiry(
        { cookies: [cookie("a", in5d)], origins: [] },
        now
      ).getTime()
    ).toBe(in5d * 1000)
    const far = now.getTime() / 1000 + 400 * 86_400
    expect(
      estimateExpiry(
        { cookies: [cookie("a", far)], origins: [] },
        now
      ).toISOString()
    ).toBe("2027-01-21T12:00:00.000Z")
  })

  it("picks only active, unexpired rows", () => {
    const base = {
      user_id: "u",
      site: "gupy.io",
      storage_enc: null,
      native_ref: null,
      updated_at: "",
    }
    const rows: AuthStateRow[] = [
      { ...base, provider: "steel", status: "expired", expires_at: null },
      {
        ...base,
        provider: "kernel",
        status: "active",
        expires_at: "2020-01-01T00:00:00Z",
      },
      {
        ...base,
        provider: "browserbase",
        status: "active",
        expires_at: "2099-01-01T00:00:00Z",
      },
    ]
    expect(pickAuthState(rows)?.provider).toBe("browserbase")
  })
})

function config(
  id: string,
  provider: ProviderConfig["provider"],
  priority: number
): ProviderConfig {
  return {
    id,
    provider,
    label: id,
    accountEmail: null,
    secretEnvVar: "X",
    projectEnvVar: null,
    enabled: true,
    priority,
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
  }
}

describe("selector prefer + beforeCreate", () => {
  it("tries preferred provider types first and passes native persistence", async () => {
    const created: unknown[] = []
    const adapter = (
      type: ProviderConfig["provider"]
    ): BrowserProviderAdapter => ({
      type,
      createSession: async (o) => (
        created.push({ type, persistence: o.persistence }),
        { externalId: type, cdpUrl: "wss://x", liveViewUrl: null }
      ),
      closeSession: async () => undefined,
    })
    const acquired = await acquireBrowser(
      {
        providers: [config("s", "steel", 1), config("k", "kernel", 30)],
        usedUnits: async () => 0,
        concurrency: new MemoryConcurrencyStore(),
        adapterFor: (c) => adapter(c.provider),
      },
      {
        timeoutSeconds: 60,
        prefer: ["kernel"],
        beforeCreate: async (c) => ({
          persistence: { [c.provider]: { ref: "prof-1", save: true } },
        }),
      }
    )
    expect(acquired.config.provider).toBe("kernel")
    expect(created).toEqual([
      {
        type: "kernel",
        persistence: { kernel: { ref: "prof-1", save: true } },
      },
    ])
  })
})

describe("native persistence in adapters", () => {
  const jsonFetch = (responses: Record<string, unknown>) => {
    const calls: { url: string; body: unknown }[] = []
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        body: init?.body ? JSON.parse(String(init.body)) : null,
      })
      const key = Object.keys(responses).find((k) => url.endsWith(k))
      return new Response(JSON.stringify(key ? responses[key] : {}), {
        status: 200,
      })
    })
    return { f, calls }
  }

  it("kernel creates a profile and opens the browser with it", async () => {
    const { f, calls } = jsonFetch({
      "/profiles": { id: "prof-9" },
      "/browsers": {
        session_id: "b1",
        cdp_ws_url: "wss://k",
        browser_live_view_url: "https://live/k",
      },
    })
    const k = kernelAdapter({ apiKey: "t" }, { fetch: f })
    expect(await k.createPersistence!("vp-u-gupy.io")).toBe("prof-9")
    const s = await k.createSession({
      timeoutSeconds: 60,
      headful: true,
      persistence: { kernel: { ref: "prof-9", save: true } },
    })
    expect(s.liveViewUrl).toBe("https://live/k")
    expect(calls[1]!.body).toMatchObject({
      profile: { id: "prof-9", save_changes: true },
      headless: false,
    })
  })

  it("browserbase creates a context and persists it on the session", async () => {
    const { f, calls } = jsonFetch({
      "/contexts": { id: "ctx-1" },
      "/sessions": { id: "s1", connectUrl: "wss://bb" },
      "/debug": { debuggerFullscreenUrl: "https://live/bb" },
    })
    const bb = browserbaseAdapter({ apiKey: "t", projectId: "p" }, { fetch: f })
    expect(await bb.createPersistence!("x")).toBe("ctx-1")
    const s = await bb.createSession({
      timeoutSeconds: 60,
      persistence: { browserbase: { ref: "ctx-1", save: true } },
    })
    expect(s.liveViewUrl).toBe("https://live/bb")
    expect(calls[1]!.body).toMatchObject({
      browserSettings: { context: { id: "ctx-1", persist: true } },
    })
  })

  it("ignores persistence meant for another provider", async () => {
    const { f, calls } = jsonFetch({
      "/browsers": { session_id: "b1", cdp_ws_url: "wss://k" },
    })
    await kernelAdapter({ apiKey: "t" }, { fetch: f }).createSession({
      timeoutSeconds: 60,
      persistence: { browserbase: { ref: "c", save: true } },
    })
    expect(calls[0]!.body).not.toHaveProperty("profile")
  })
})

describe("runLoginJob", () => {
  function fakeBrowser(state: StorageState) {
    const page = { goto: vi.fn(async () => null) }
    const context = {
      pages: () => [page],
      newPage: async () => page,
      addCookies: vi.fn(async () => undefined),
      addInitScript: vi.fn(async () => undefined),
      storageState: vi.fn(async () => state),
      newCDPSession: vi.fn(),
    }
    const browser = {
      contexts: () => [context],
      newContext: async () => context,
      close: vi.fn(async () => undefined),
    }
    return { browser: browser as unknown as Browser, page, context }
  }

  function setup(state: StorageState) {
    const { client, db } = fakeSupabase({
      browser_providers: [],
      browser_sessions: [],
      browser_auth_states: [],
      browser_login_sessions: [
        {
          id: "11111111-1111-1111-1111-111111111111",
          user_id: "user-1",
          site: "gupy.io",
          login_url: "https://empresa.gupy.io/candidates/signin",
          apply_run_id: "run-1",
          status: "starting",
        },
      ],
    })
    const providers = [
      config("bb", "browserbase", 40),
      config("st", "steel", 1),
    ]
    db.browser_providers = providers.map((p) => ({
      id: p.id,
      provider: p.provider,
      label: p.label,
      account_email: null,
      secret_env_var: "X",
      project_env_var: null,
      enabled: true,
      priority: p.priority,
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
      notes: null,
    }))
    const createPersistence = vi.fn(async () => "ctx-42")
    const adapterFor = (c: ProviderConfig): BrowserProviderAdapter => ({
      type: c.provider,
      createSession: async () => ({
        externalId: `${c.provider}-s`,
        cdpUrl: "wss://x",
        liveViewUrl: `https://live/${c.provider}`,
      }),
      closeSession: async () => undefined,
      ...(c.provider === "browserbase" ? { createPersistence } : {}),
    })
    return { client, db, adapterFor, createPersistence }
  }

  it("prefers Browserbase live view, waits for 'pronto' and saves the sealed state", async () => {
    const state: StorageState = {
      cookies: [cookie(".gupy.io"), cookie(".tracker.com")],
      origins: [],
    }
    const { client, db, adapterFor, createPersistence } = setup(state)
    const fb = fakeBrowser(state)
    const onSaved = vi.fn(async () => undefined)
    const login = db.browser_login_sessions![0]!
    const job = runLoginJob(login.id as string, {
      env,
      admin: client,
      adapterFor,
      connect: async () => fb.browser,
      pollMs: 5,
      waitMs: 5000,
      onSaved,
    })
    await vi.waitFor(() => expect(login.status).toBe("waiting_user"))
    expect(login.live_view_url).toBe("https://live/browserbase")
    expect(login.provider).toBe("browserbase")
    login.status = "confirm_requested"
    const result = await job
    expect(result.status).toBe("saved")
    expect(createPersistence).toHaveBeenCalledOnce()
    const saved = db.browser_auth_states![0]!
    expect(saved).toMatchObject({
      user_id: "user-1",
      site: "gupy.io",
      provider: "browserbase",
      native_ref: "ctx-42",
      status: "active",
    })
    expect(String(saved.storage_enc)).not.toContain("secret-cookie")
    const opened = await authSealerFromEnv(env).open(
      "user-1",
      "gupy.io",
      "browserbase",
      saved.storage_enc as string
    )
    expect(opened?.cookies.map((c) => c.domain)).toEqual([".gupy.io"])
    expect(login.live_view_url).toBeNull()
    expect(onSaved).toHaveBeenCalledWith(
      expect.objectContaining({ apply_run_id: "run-1" })
    )
    expect(fb.page.goto).toHaveBeenCalledWith(
      "https://empresa.gupy.io/candidates/signin",
      expect.anything()
    )
  })

  it("keeps waiting when 'pronto' comes before the login finished, and expires", async () => {
    const { client, db, adapterFor } = setup({ cookies: [], origins: [] })
    const fb = fakeBrowser({ cookies: [], origins: [] })
    const login = db.browser_login_sessions![0]!
    const job = runLoginJob(login.id as string, {
      env,
      admin: client,
      adapterFor,
      connect: async () => fb.browser,
      pollMs: 5,
      waitMs: 300,
    })
    await vi.waitFor(() => expect(login.status).toBe("waiting_user"))
    login.status = "confirm_requested"
    await vi.waitFor(() => expect(login.last_error).toMatch(/Termine o login/))
    const result = await job
    expect(result.status).toBe("expired")
    expect(db.browser_auth_states).toHaveLength(0)
  })

  it("does nothing for a login that is not starting", async () => {
    const { client, db, adapterFor } = setup({ cookies: [], origins: [] })
    db.browser_login_sessions![0]!.status = "cancelled"
    expect(
      (
        await runLoginJob("11111111-1111-1111-1111-111111111111", {
          env,
          admin: client,
          adapterFor,
        })
      ).status
    ).toBe("skipped")
  })
})
