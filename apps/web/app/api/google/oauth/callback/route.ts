import type { NextRequest } from "next/server"

import { logAudit } from "@vagapilot/core/audit"
import {
  completeGmailConnection,
  consentPurposeForKind,
  runGmailSync,
  statesMatch,
} from "@vagapilot/gmail"
import {
  gmailConnectedEvent,
  inngest,
  isInngestConfigured,
} from "@vagapilot/jobs"

import { getUserContext } from "@/lib/server/context"
import {
  decodeTransaction,
  GMAIL_OAUTH_COOKIE,
  GMAIL_OAUTH_COOKIE_PATH,
} from "@/lib/gmail/oauth-cookie"
import { settingsRedirect } from "@/lib/gmail/http"
import { getGmailRuntime } from "@/lib/gmail/runtime"

/** Consent text version recorded in `consents` for gmail_leitura / gmail_envio. */
const GMAIL_CONSENT_VERSION = "v1"

/**
 * GET /api/google/oauth/callback (P4.1). Validates state (constant time), the user who started
 * the flow and the PKCE verifier; stores the refresh token encrypted and records the consent.
 * The first 90-day load runs in Inngest, or inline when no Inngest is configured (dev).
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const transaction = decodeTransaction(
    request.cookies.get(GMAIL_OAUTH_COOKIE)?.value
  )

  const finish = (query: Record<string, string>) => {
    const response = settingsRedirect(query)
    response.cookies.set(GMAIL_OAUTH_COOKIE, "", {
      path: GMAIL_OAUTH_COOKIE_PATH,
      maxAge: 0,
    })
    return response
  }

  const state = params.get("state") ?? ""
  if (!transaction || !statesMatch(transaction.state, state)) {
    return finish({ gmail: "erro", motivo: "invalid_state" })
  }
  if (params.get("error")) return finish({ gmail: "erro", motivo: "denied" })
  const code = params.get("code")
  if (!code) return finish({ gmail: "erro", motivo: "invalid_state" })

  const session = await getUserContext()
  if (!session.ok || session.ctx.user.id !== transaction.userId) {
    return finish({ gmail: "erro", motivo: "invalid_state" })
  }
  const { user, supabase } = session.ctx
  const runtime = getGmailRuntime()
  if (!runtime) return finish({ gmail: "erro", motivo: "not_configured" })

  const result = await completeGmailConnection(runtime, {
    userId: user.id,
    kind: transaction.kind,
    code,
    codeVerifier: transaction.verifier,
    redirectUri: transaction.redirectUri,
    emailHint: user.email || undefined,
  })
  if (!result.ok) return finish({ gmail: "erro", motivo: result.code })

  await supabase.from("consents").insert({
    user_id: user.id,
    purpose: consentPurposeForKind(transaction.kind),
    version: GMAIL_CONSENT_VERSION,
    granted: true,
  })
  await logAudit(runtime.audit, {
    userId: user.id,
    actor: "usuario",
    action: "gmail.connected",
    targetType: "gmail_connection",
    details: { kind: transaction.kind, scopes: result.scopes.length },
    userAgent: request.headers.get("user-agent") ?? undefined,
  })

  if (transaction.kind === "leitura") {
    if (isInngestConfigured()) {
      await inngest.send(gmailConnectedEvent.create({ userId: user.id }))
    } else {
      await runGmailSync(runtime, user.id, "initial", { actor: "usuario" })
    }
  }
  return finish({ gmail: transaction.kind === "envio" ? "envio" : "conectado" })
}
