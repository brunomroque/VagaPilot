import { NextResponse, type NextRequest } from "next/server"

import {
  createOAuthState,
  createPkcePair,
  hasScope,
  isGmailScopeKind,
  scopeForKind,
} from "@vagapilot/gmail"

import { getCurrentUser } from "@/lib/auth/session"
import { checkGmailActivation } from "@/lib/gmail/activation"
import {
  cookieOptions,
  encodeTransaction,
  GMAIL_OAUTH_COOKIE,
} from "@/lib/gmail/oauth-cookie"
import {
  gmailRedirectUri,
  isSameSiteNavigation,
  settingsRedirect,
} from "@/lib/gmail/http"
import { getGmailRuntime } from "@/lib/gmail/runtime"
import { apiError } from "@/lib/http"

/**
 * GET /api/google/oauth/start?scope=leitura|envio (P4.1, RF11.1). Incremental consent:
 * "leitura" asks only gmail.readonly; "envio" asks gmail.send separately and only after reading
 * is connected. State + PKCE (S256) are kept in a short-lived httpOnly cookie.
 */
export async function GET(request: NextRequest) {
  if (!isSameSiteNavigation(request)) {
    return apiError(
      "invalid_request",
      "Start the connection from the app.",
      403
    )
  }
  const user = await getCurrentUser()
  if (!user) return apiError("unauthorized", "Sign in first.", 401)

  const kind = request.nextUrl.searchParams.get("scope") ?? "leitura"
  if (!isGmailScopeKind(kind))
    return apiError("invalid_request", "Unknown scope.", 400)

  const runtime = getGmailRuntime()
  if (!runtime?.oauth)
    return settingsRedirect({ gmail: "erro", motivo: "not_configured" })

  const activation = await checkGmailActivation(user)
  if (!activation.ok)
    return settingsRedirect({ gmail: "erro", motivo: activation.reason })

  if (kind === "envio") {
    const connection = await runtime.store.getConnection(user.id)
    if (!connection || !hasScope(connection.scopes, "leitura")) {
      return settingsRedirect({ gmail: "erro", motivo: "read_first" })
    }
  }

  const state = createOAuthState()
  const { verifier, challenge } = createPkcePair()
  const redirectUri = gmailRedirectUri(request)
  const url = runtime.oauth.authorizationUrl({
    redirectUri,
    scope: scopeForKind(kind),
    state,
    codeChallenge: challenge,
    loginHint: user.email || undefined,
  })

  const response = NextResponse.redirect(url, 303)
  response.cookies.set(
    GMAIL_OAUTH_COOKIE,
    encodeTransaction({
      state,
      verifier,
      kind,
      userId: user.id,
      redirectUri,
      createdAt: Date.now(),
    }),
    cookieOptions(request.nextUrl.protocol === "https:")
  )
  return response
}
