import { logAudit, type AuditActor } from "@vagapilot/core/audit"

import { createRestGmailApi } from "./api.js"
import type { RevokeResult } from "./oauth.js"
import { GmailTokenError, type GmailRuntime } from "./runtime.js"
import {
  GMAIL_READONLY_SCOPE,
  scopeForKind,
  type GmailScopeKind,
} from "./scopes.js"

/** Connection lifecycle (P4.1): finish OAuth, store the token encrypted, revoke (RF11.9, CA11.3). */

export type ConnectResult =
  | { ok: true; googleEmail: string; scopes: string[] }
  | {
      ok: false
      code:
        | "not_configured"
        | "missing_refresh_token"
        | "scope_not_granted"
        | "oauth_failed"
    }

export async function completeGmailConnection(
  runtime: GmailRuntime,
  input: {
    userId: string
    kind: GmailScopeKind
    code: string
    codeVerifier: string
    redirectUri: string
    emailHint?: string
  }
): Promise<ConnectResult> {
  const { oauth, store, fieldCrypto } = runtime
  if (!oauth) return { ok: false, code: "not_configured" }

  let grant
  try {
    grant = await oauth.exchangeCode(
      input.code,
      input.codeVerifier,
      input.redirectUri
    )
  } catch {
    return { ok: false, code: "oauth_failed" }
  }
  const requested = scopeForKind(input.kind)
  if (!grant.scopes.includes(requested))
    return { ok: false, code: "scope_not_granted" }

  const existing = await store.getConnection(input.userId)
  const scopes = [
    ...new Set([...(existing?.scopes ?? []), ...grant.scopes]),
  ].filter((scope) =>
    scope.startsWith("https://www.googleapis.com/auth/gmail.")
  )
  let sealed: Uint8Array | null = null
  if (grant.refreshToken) {
    sealed = await fieldCrypto.encryptField(input.userId, grant.refreshToken)
  } else if (existing) {
    sealed = await store.readRefreshToken(input.userId)
  }
  if (!sealed) return { ok: false, code: "missing_refresh_token" }

  let googleEmail = existing?.googleEmail ?? input.emailHint ?? ""
  if (scopes.includes(GMAIL_READONLY_SCOPE)) {
    try {
      const api =
        runtime.mode === "google"
          ? createRestGmailApi({
              getAccessToken: async () => grant.accessToken,
            })
          : await runtime.apiFor(input.userId, { emailHint: input.emailHint })
      googleEmail = (await api.getProfile()).emailAddress
    } catch {
      // Keep the hint; the profile is only used to show which account is connected.
    }
  }

  await store.upsertConnection({
    userId: input.userId,
    googleEmail: googleEmail || "conta Google",
    scopes,
    refreshTokenEnc: sealed,
  })
  return { ok: true, googleEmail: googleEmail || "conta Google", scopes }
}

export type RevokeOutcome = {
  existed: boolean
  google: RevokeResult | "skipped"
}

/**
 * Revokes at Google, deletes the token row (stopping any running sync at its next message) and
 * writes `gmail.revoked`. Local deletion happens even when Google is unreachable.
 */
export async function revokeGmailConnection(
  runtime: GmailRuntime,
  userId: string,
  options: { actor?: AuditActor; userAgent?: string } = {}
): Promise<RevokeOutcome> {
  const { store, oauth, fieldCrypto } = runtime
  let google: RevokeOutcome["google"] = "skipped"
  try {
    const sealed = await store.readRefreshToken(userId)
    if (sealed && oauth) {
      const token = await fieldCrypto
        .decryptFieldText(userId, sealed)
        .catch(() => {
          throw new GmailTokenError("token_unreadable")
        })
      google = await oauth.revoke(token)
    }
  } catch (error) {
    if (!(error instanceof GmailTokenError)) throw error
  }
  const existed = await store.deleteConnection(userId)
  if (existed) {
    await logAudit(runtime.audit, {
      userId,
      actor: options.actor ?? "usuario",
      action: "gmail.revoked",
      targetType: "gmail_connection",
      details: { google },
      userAgent: options.userAgent,
    })
  }
  return { existed, google }
}
