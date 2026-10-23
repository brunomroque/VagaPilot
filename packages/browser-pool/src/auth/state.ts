import type { SupabaseClient } from "@supabase/supabase-js"
import { fromBytea, toBytea } from "@vagapilot/db/server"

import {
  authAad,
  authStateKeyFromEnv,
  isSealedAuthState,
  openAuthState,
  sealAuthState,
} from "./crypto.js"

type Env = Record<string, string | undefined>

/** Playwright storageState shape (kept local so this module has no playwright import). */
export type StorageState = {
  cookies: {
    name: string
    value: string
    domain: string
    path: string
    expires: number
    httpOnly: boolean
    secure: boolean
    sameSite: "Strict" | "Lax" | "None"
  }[]
  origins: { origin: string; localStorage: { name: string; value: string }[] }[]
}

export type AuthStateRow = {
  user_id: string
  site: string
  provider: string
  storage_enc: string | null
  native_ref: string | null
  status: string
  expires_at: string | null
  updated_at: string
}

export const AUTH_STATE_COLUMNS =
  "user_id, site, provider, storage_enc, native_ref, status, expires_at, updated_at"

/** Registrable-ish domain used as the session key: "empresa.gupy.io" -> "gupy.io". */
export function siteOf(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "")
    const parts = host.split(".")
    // Two-level public suffixes common in BR (com.br, gov.br, ...): keep three labels.
    const take =
      parts.length > 2 &&
      /^(com|net|org|gov|edu)$/.test(parts[parts.length - 2]!)
        ? 3
        : 2
    return parts.slice(-take).join(".")
  } catch {
    return "unknown"
  }
}

export function normalizeLoginUrl(raw: string): string | null {
  const text = raw.trim()
  if (!text) return null
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`)
    if (url.protocol !== "https:" && url.protocol !== "http:") return null
    if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.)/.test(url.hostname))
      return null
    return url.toString()
  } catch {
    return null
  }
}

/** Keeps only cookies/origins of the site so a session never leaks to other domains. */
export function filterStateForSite(
  state: StorageState,
  site: string
): StorageState {
  const match = (host: string) => {
    const h = host.replace(/^\./, "").toLowerCase()
    return h === site || h.endsWith(`.${site}`)
  }
  return {
    cookies: (state.cookies ?? []).filter((c) => match(c.domain)),
    origins: (state.origins ?? []).filter((o) => {
      try {
        return match(new URL(o.origin).hostname)
      } catch {
        return false
      }
    }),
  }
}

const DEFAULT_TTL_DAYS = 30

/**
 * Best guess of when the login dies: the latest expiry among persistent cookies, capped at
 * 90 days; session-only cookies (expires = -1) fall back to 30 days.
 */
export function estimateExpiry(
  state: StorageState,
  now: Date = new Date()
): Date {
  const persistent = state.cookies
    .map((c) => c.expires)
    .filter((e) => typeof e === "number" && e > 0)
  const cap = now.getTime() + 90 * 86_400_000
  if (!persistent.length)
    return new Date(now.getTime() + DEFAULT_TTL_DAYS * 86_400_000)
  const latest = Math.max(...persistent) * 1000
  return new Date(Math.min(Math.max(latest, now.getTime() + 3_600_000), cap))
}

export type AuthSealer = {
  seal(
    userId: string,
    site: string,
    provider: string,
    value: StorageState
  ): Promise<string>
  open(
    userId: string,
    site: string,
    provider: string,
    column: string | null
  ): Promise<StorageState | null>
}

/**
 * Seals with AUTH_STATE_ENCRYPTION_KEY. Legacy DEK-sealed rows are opened through `legacyOpen`.
 * Writing without the key is refused: sessions must never be stored in clear.
 */
export function authSealerFromEnv(
  env: Env = process.env,
  legacyOpen?: (userId: string, bytes: Uint8Array) => Promise<unknown>
): AuthSealer {
  const key = authStateKeyFromEnv(env)
  return {
    async seal(userId, site, provider, value) {
      if (!key)
        throw new Error("AUTH_STATE_ENCRYPTION_KEY não está configurada.")
      return toBytea(sealAuthState(key, authAad(userId, site, provider), value))
    },
    async open(userId, site, provider, column) {
      const bytes = column ? fromBytea(column) : null
      if (!bytes) return null
      try {
        if (isSealedAuthState(bytes))
          return key
            ? openAuthState<StorageState>(
                key,
                authAad(userId, site, provider),
                bytes
              )
            : null
        const legacy = (await legacyOpen?.(userId, bytes)) as
          Partial<StorageState> | null | undefined
        return legacy
          ? { cookies: legacy.cookies ?? [], origins: legacy.origins ?? [] }
          : null
      } catch {
        return null
      }
    },
  }
}

export async function listAuthStates(
  admin: SupabaseClient,
  userId: string,
  site?: string
): Promise<AuthStateRow[]> {
  let query = admin
    .from("browser_auth_states")
    .select(AUTH_STATE_COLUMNS)
    .eq("user_id", userId)
  if (site) query = query.eq("site", site)
  const { data } = await query.order("updated_at", { ascending: false })
  return (data ?? []) as AuthStateRow[]
}

/** Most useful saved login for a site: active first, then newest. */
export function pickAuthState(
  rows: AuthStateRow[],
  now: Date = new Date()
): AuthStateRow | null {
  const alive = rows.filter(
    (r) =>
      r.status === "active" && (!r.expires_at || new Date(r.expires_at) > now)
  )
  return alive[0] ?? null
}

export async function saveAuthState(
  admin: SupabaseClient,
  sealer: AuthSealer,
  input: {
    userId: string
    site: string
    provider: string
    state: StorageState
    nativeRef?: string | null
    now?: Date
  }
): Promise<{ expiresAt: string; cookies: number }> {
  const state = filterStateForSite(input.state, input.site)
  const expiresAt = estimateExpiry(state, input.now).toISOString()
  const { error } = await admin.from("browser_auth_states").upsert(
    {
      user_id: input.userId,
      site: input.site,
      provider: input.provider,
      storage_enc: await sealer.seal(
        input.userId,
        input.site,
        input.provider,
        state
      ),
      native_ref: input.nativeRef ?? null,
      status: "active",
      expires_at: expiresAt,
      updated_at: (input.now ?? new Date()).toISOString(),
    },
    { onConflict: "user_id,site,provider" }
  )
  if (error) throw new Error(`browser_auth_states: ${error.message}`)
  return { expiresAt, cookies: state.cookies.length }
}

export async function markAuthExpired(
  admin: SupabaseClient,
  userId: string,
  site: string
): Promise<void> {
  await admin
    .from("browser_auth_states")
    .update({ status: "expired", updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("site", site)
    .eq("status", "active")
}
