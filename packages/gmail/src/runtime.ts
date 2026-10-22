import process from "node:process"

import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import {
  createFieldCrypto,
  keyProviderFromEnv,
  type FieldCrypto,
} from "@vagapilot/core/crypto"
import { SupabaseAuditSink, SupabaseDekStore } from "@vagapilot/db/server"
import type { AuditSink } from "@vagapilot/core/audit"
import type { LanguageModel } from "ai"

import type { JobAlertHandler } from "./alerts.js"
import { createRestGmailApi, type GmailApi } from "./api.js"
import {
  createFileMailboxSource,
  createFixtureGmailApi,
  createMockOAuthClient,
  type MailboxSource,
} from "./mock.js"
import {
  createGoogleOAuthClient,
  GoogleOAuthError,
  type GoogleOAuthClient,
} from "./oauth.js"
import { GmailStore } from "./store.js"

type Env = Readonly<Record<string, string | undefined>>

/**
 * google: real OAuth + Gmail REST (GOOGLE_CLIENT_ID/SECRET set).
 * mock: fixture mailbox + fake consent (dev/tests only: VAGAPILOT_GMAIL_MOCK=1 and not production).
 * unconfigured: nothing to connect to; the UI disables the button and explains why.
 */
export type GmailMode = "google" | "mock" | "unconfigured"

export function isGmailMockEnabled(env: Env = process.env): boolean {
  return env.NODE_ENV !== "production" && env.VAGAPILOT_GMAIL_MOCK === "1"
}

export function gmailMode(env: Env = process.env): GmailMode {
  if (isGmailMockEnabled(env)) return "mock"
  if (env.GOOGLE_CLIENT_ID?.trim() && env.GOOGLE_CLIENT_SECRET?.trim())
    return "google"
  return "unconfigured"
}

/** Logs carry counts and ids only, never e-mail content or addresses (CA11.4, 7 "logs sem PII"). */
export type GmailLogger = (
  event: string,
  fields?: Record<string, string | number | boolean | null>
) => void

export const consoleGmailLogger: GmailLogger = (event, fields) => {
  console.info(`[gmail] ${event}`, fields ?? {})
}

export class GmailTokenError extends Error {
  constructor(
    readonly code: "no_connection" | "token_revoked" | "token_unreadable"
  ) {
    super(`Gmail token unavailable: ${code}`)
    this.name = "GmailTokenError"
  }
}

export type GmailRuntime = {
  mode: GmailMode
  admin: SupabaseClient
  store: GmailStore
  audit: AuditSink
  oauth: GoogleOAuthClient | null
  fieldCrypto: FieldCrypto
  /** Fixture mailbox in mock mode. */
  mailbox: MailboxSource | null
  classifierModel?: LanguageModel
  onJobAlert?: JobAlertHandler
  log: GmailLogger
  now: () => Date
  apiFor(userId: string, options?: { emailHint?: string }): Promise<GmailApi>
}

export type GmailRuntimeOptions = {
  admin?: SupabaseClient
  env?: Env
  fetch?: typeof fetch
  oauth?: GoogleOAuthClient
  fieldCrypto?: FieldCrypto
  mailbox?: MailboxSource
  /** Overrides the Gmail API (tests). */
  api?: (userId: string) => Promise<GmailApi> | GmailApi
  classifierModel?: LanguageModel
  onJobAlert?: JobAlertHandler
  audit?: AuditSink
  log?: GmailLogger
  now?: () => Date
}

export function createAdminClientFromEnv(
  env: Env = process.env
): SupabaseClient {
  const url = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY are required"
    )
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export function createGmailRuntime(
  options: GmailRuntimeOptions = {}
): GmailRuntime {
  const env = options.env ?? process.env
  const mode = gmailMode(env)
  const admin = options.admin ?? createAdminClientFromEnv(env)
  const store = new GmailStore(admin)
  const now = options.now ?? (() => new Date())
  const fieldCrypto =
    options.fieldCrypto ??
    createFieldCrypto({
      keyProvider: keyProviderFromEnv(env),
      dekStore: new SupabaseDekStore(admin),
    })
  const mailbox =
    options.mailbox ?? (mode === "mock" ? createFileMailboxSource() : null)

  let oauth: GoogleOAuthClient | null = options.oauth ?? null
  if (!oauth) {
    switch (mode) {
      case "mock":
        oauth = createMockOAuthClient({ now })
        break
      case "google":
        oauth = createGoogleOAuthClient({
          clientId: env.GOOGLE_CLIENT_ID ?? "",
          clientSecret: env.GOOGLE_CLIENT_SECRET ?? "",
          fetch: options.fetch,
          now,
        })
        break
      case "unconfigured":
        oauth = null
        break
      default: {
        const unreachable: never = mode
        throw new Error(`Unknown Gmail mode: ${String(unreachable)}`)
      }
    }
  }

  const accessTokens = new Map<string, { token: string; expiresAt: number }>()

  async function accessTokenFor(userId: string): Promise<string> {
    const cached = accessTokens.get(userId)
    if (cached && cached.expiresAt - 60_000 > now().getTime())
      return cached.token
    if (!oauth) throw new GmailTokenError("no_connection")
    const sealed = await store.readRefreshToken(userId)
    if (!sealed) throw new GmailTokenError("no_connection")
    let refreshToken: string
    try {
      refreshToken = await fieldCrypto.decryptFieldText(userId, sealed)
    } catch {
      throw new GmailTokenError("token_unreadable")
    }
    try {
      const fresh = await oauth.refreshAccessToken(refreshToken)
      accessTokens.set(userId, {
        token: fresh.accessToken,
        expiresAt: fresh.expiresAt.getTime(),
      })
      return fresh.accessToken
    } catch (error) {
      if (error instanceof GoogleOAuthError && error.code === "invalid_grant") {
        throw new GmailTokenError("token_revoked")
      }
      throw error
    }
  }

  return {
    mode,
    admin,
    store,
    audit: options.audit ?? new SupabaseAuditSink(admin),
    oauth,
    fieldCrypto,
    mailbox,
    classifierModel: options.classifierModel,
    onJobAlert: options.onJobAlert,
    log: options.log ?? consoleGmailLogger,
    now,
    async apiFor(userId, apiOptions = {}) {
      if (options.api) return options.api(userId)
      if (mode === "mock" && mailbox) {
        const connection = await store.getConnection(userId)
        return createFixtureGmailApi({
          source: mailbox,
          userId,
          emailAddress:
            connection?.googleEmail ??
            apiOptions.emailHint ??
            "conta.ficticia@gmail.test",
          now,
        })
      }
      return createRestGmailApi({
        getAccessToken: () => accessTokenFor(userId),
        fetch: options.fetch,
      })
    },
  }
}

let defaultRuntime: GmailRuntime | undefined

/** Lazily built from process.env (service_role). Server only. */
export function getDefaultGmailRuntime(): GmailRuntime {
  defaultRuntime ??= createGmailRuntime()
  return defaultRuntime
}
