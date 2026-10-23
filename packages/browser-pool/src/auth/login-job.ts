import type { SupabaseClient } from "@supabase/supabase-js"
import type { Browser, BrowserContext } from "playwright-core"

import {
  acquireTrackedBrowser,
  isPoolEnabled,
  type PoolRuntime,
  type TrackedBrowser,
} from "../pool/supabase.js"
import type {
  BrowserProviderAdapter,
  ProviderConfig,
  ProviderType,
} from "../pool/types.js"
import {
  authSealerFromEnv,
  filterStateForSite,
  listAuthStates,
  saveAuthState,
  type AuthSealer,
  type StorageState,
} from "./state.js"

type Env = Record<string, string | undefined>

/** Providers whose live view works well on a phone; the rest of the pool is the fallback. */
export const LIVE_VIEW_PREFERENCE: ProviderType[] = [
  "browserbase",
  "kernel",
  "browserless",
  "steel",
]

export type LoginStatus =
  | "starting"
  | "opening"
  | "waiting_user"
  | "confirm_requested"
  | "saved"
  | "cancelled"
  | "expired"
  | "failed"

export const LOGIN_OPEN_STATUSES: LoginStatus[] = [
  "starting",
  "opening",
  "waiting_user",
  "confirm_requested",
]

export type LoginRow = {
  id: string
  user_id: string
  site: string
  login_url: string
  apply_run_id: string | null
  status: LoginStatus
}

export type LoginJobOptions = {
  env?: Env
  admin: SupabaseClient
  sealer?: AuthSealer
  adapterFor?: (config: ProviderConfig) => BrowserProviderAdapter | null
  connect?: (cdpUrl: string) => Promise<Browser>
  /** How long the user has to finish the login in the live view. */
  waitMs?: number
  pollMs?: number
  /** Called after the session is saved (e.g. resume the paused apply run). */
  onSaved?: (row: LoginRow) => Promise<void>
}

export type LoginJobResult = {
  loginId: string
  status: LoginStatus | "skipped"
}

async function defaultConnect(cdpUrl: string): Promise<Browser> {
  const { chromium } = await import("playwright-core")
  return chromium.connectOverCDP(cdpUrl, { timeout: 45_000 })
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function update(
  admin: SupabaseClient,
  id: string,
  patch: Record<string, unknown>
) {
  await admin
    .from("browser_login_sessions")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
}

async function currentStatus(
  admin: SupabaseClient,
  id: string
): Promise<LoginStatus | null> {
  const { data } = await admin
    .from("browser_login_sessions")
    .select("status")
    .eq("id", id)
    .maybeSingle()
  return ((data as { status?: LoginStatus } | null)?.status ??
    null) as LoginStatus | null
}

export async function applyStorageState(
  context: BrowserContext,
  state: StorageState | null
): Promise<void> {
  if (!state) return
  if (state.cookies?.length)
    await context.addCookies(state.cookies).catch(() => undefined)
  if (state.origins?.length) {
    const origins = state.origins
    await context
      .addInitScript(
        (
          items: {
            origin: string
            localStorage: { name: string; value: string }[]
          }[]
        ) => {
          const match = items.find((o) => o.origin === window.location.origin)
          if (!match) return
          for (const entry of match.localStorage) {
            try {
              if (window.localStorage.getItem(entry.name) === null)
                window.localStorage.setItem(entry.name, entry.value)
            } catch {
              // Storage blocked on this origin.
            }
          }
        },
        origins
      )
      .catch(() => undefined)
  }
}

/**
 * Interactive login: opens a cloud browser on the site's login page and hands the user a live
 * view (Browserbase/Kernel first). The user types password and 2FA there; the app never sees
 * them. When the user taps "pronto" (status confirm_requested) the Playwright storageState is
 * sealed with AUTH_STATE_ENCRYPTION_KEY and the provider's native persistence (Browserbase
 * Context / Kernel Profile) is kept as `native_ref`.
 *
 * Runs inside one long invocation (Netlify background function) because the CDP connection has
 * to stay open while the user logs in.
 */
export async function runLoginJob(
  loginId: string,
  options: LoginJobOptions
): Promise<LoginJobResult> {
  const env = options.env ?? process.env
  const admin = options.admin
  const sealer = options.sealer ?? authSealerFromEnv(env)
  const waitMs = options.waitMs ?? 10 * 60_000
  const pollMs = options.pollMs ?? 3000

  const claimed = await admin
    .from("browser_login_sessions")
    .update({ status: "opening", updated_at: new Date().toISOString() })
    .eq("id", loginId)
    .eq("status", "starting")
    .select("id, user_id, site, login_url, apply_run_id, status")
    .maybeSingle()
  const row = claimed.data as LoginRow | null
  if (!row) return { loginId, status: "skipped" }
  if (!isPoolEnabled(env) && !options.adapterFor) {
    await update(admin, loginId, {
      status: "failed",
      last_error: "BROWSER_POOL_ENABLED não está ativo.",
    })
    return { loginId, status: "failed" }
  }

  const existing = await listAuthStates(admin, row.user_id, row.site)
  let nativeRef: string | null = null
  let tracked: TrackedBrowser
  const runtime: PoolRuntime = { admin, env, adapterFor: options.adapterFor }
  try {
    tracked = await acquireTrackedBrowser(runtime, {
      timeoutSeconds: Math.ceil(waitMs / 1000) + 120,
      headful: true,
      userId: row.user_id,
      purpose: "login",
      prefer: LIVE_VIEW_PREFERENCE,
      async beforeCreate(config, adapter) {
        nativeRef = null
        if (!adapter.createPersistence) return
        try {
          nativeRef =
            existing.find((r) => r.provider === config.provider && r.native_ref)
              ?.native_ref ??
            (await adapter.createPersistence(
              `vp-${row.user_id.slice(0, 8)}-${row.site}`
            ))
        } catch {
          nativeRef = null // Native persistence is a bonus; storageState still works.
        }
        return nativeRef
          ? {
              persistence: {
                [config.provider]: { ref: nativeRef, save: true },
              },
            }
          : undefined
      },
    })
  } catch (error) {
    await update(admin, loginId, {
      status: "failed",
      last_error:
        error instanceof Error
          ? error.message.slice(0, 400)
          : "Sem navegador disponível.",
    })
    return { loginId, status: "failed" }
  }

  let browser: Browser | null = null
  let status: LoginStatus = "failed"
  let failure: { code: string; message: string } | undefined
  try {
    browser = await (options.connect ?? defaultConnect)(tracked.session.cdpUrl)
    const context = browser.contexts()[0] ?? (await browser.newContext())
    const previous = existing.find((r) => r.status === "active") ?? existing[0]
    if (previous)
      await applyStorageState(
        context,
        await sealer.open(
          row.user_id,
          row.site,
          previous.provider,
          previous.storage_enc
        )
      )
    const page = context.pages()[0] ?? (await context.newPage())
    await page
      .goto(row.login_url, { waitUntil: "domcontentloaded", timeout: 45_000 })
      .catch(() => undefined)
    let live = tracked.session.liveViewUrl
    if (!live && tracked.adapter.liveViewFromCdp) {
      const cdp = await context.newCDPSession(page)
      live = await tracked.adapter
        .liveViewFromCdp(
          (method, params) =>
            cdp.send(method as never, params as never) as Promise<unknown>
        )
        .catch(() => null)
    }
    if (!live) throw new Error("Este provedor não ofereceu tela ao vivo.")
    await update(admin, loginId, {
      status: "waiting_user",
      provider: tracked.config.provider,
      provider_id: tracked.config.id,
      external_id: tracked.session.externalId,
      live_view_url: live,
      native_ref: nativeRef,
      expires_at: new Date(Date.now() + waitMs).toISOString(),
    })

    const until = Date.now() + waitMs
    status = "expired"
    while (Date.now() < until) {
      const current = await currentStatus(admin, loginId)
      if (current === "cancelled") {
        status = "cancelled"
        break
      }
      if (current === "confirm_requested") {
        const state = (await context.storageState()) as StorageState
        if (!filterStateForSite(state, row.site).cookies.length) {
          // Not logged in yet: keep the browser open and tell the user.
          await update(admin, loginId, {
            status: "waiting_user",
            last_error:
              "Ainda não encontrei a sessão do site. Termine o login na tela ao vivo e toque em Pronto.",
          })
        } else {
          await saveAuthState(admin, sealer, {
            userId: row.user_id,
            site: row.site,
            provider: tracked.config.provider,
            state,
            nativeRef,
          })
          status = "saved"
          break
        }
      }
      await sleep(pollMs)
    }
  } catch (error) {
    status = "failed"
    failure = {
      code: "login_failed",
      message:
        error instanceof Error ? error.message.slice(0, 300) : "login failed",
    }
  } finally {
    await browser?.close().catch(() => undefined)
    await tracked.finish(failure)
  }
  await update(admin, loginId, {
    status,
    live_view_url: null,
    last_error:
      failure?.message ??
      (status === "expired" ? "Tempo esgotado para concluir o login." : null),
  })
  if (status === "saved") await options.onSaved?.(row).catch(() => undefined)
  return { loginId, status }
}
