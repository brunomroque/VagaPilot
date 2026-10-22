import { createHash, randomBytes, timingSafeEqual } from "node:crypto"

import { z } from "zod"

/** Google OAuth 2.0 for the Gmail connection (P4.1): authorization code + PKCE (S256) + state. */

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
export const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke"

const OAUTH_TIMEOUT_MS = 10_000

function base64Url(bytes: Buffer): string {
  return bytes.toString("base64url")
}

export type PkcePair = { verifier: string; challenge: string }

/** RFC 7636: 43–128 char verifier, S256 challenge. */
export function createPkcePair(): PkcePair {
  const verifier = base64Url(randomBytes(48))
  const challenge = base64Url(createHash("sha256").update(verifier).digest())
  return { verifier, challenge }
}

export function createOAuthState(): string {
  return base64Url(randomBytes(32))
}

/** Constant-time comparison of the state echoed by Google with the one in our cookie. */
export function statesMatch(expected: string, received: string): boolean {
  const a = Buffer.from(expected)
  const b = Buffer.from(received)
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b)
}

export type AuthorizationRequest = {
  redirectUri: string
  scope: string
  state: string
  codeChallenge: string
  /** Pre-selects the account the user is signed in with. */
  loginHint?: string
}

export type TokenGrant = {
  accessToken: string
  expiresAt: Date
  /** Present on the first consent (access_type=offline + prompt=consent). */
  refreshToken: string | null
  scopes: string[]
}

export type AccessToken = { accessToken: string; expiresAt: Date }

export type GoogleOAuthErrorCode =
  "invalid_grant" | "http_error" | "invalid_response"

export class GoogleOAuthError extends Error {
  constructor(
    readonly code: GoogleOAuthErrorCode,
    message: string
  ) {
    super(message)
    this.name = "GoogleOAuthError"
  }
}

export interface GoogleOAuthClient {
  authorizationUrl(request: AuthorizationRequest): string
  exchangeCode(
    code: string,
    codeVerifier: string,
    redirectUri: string
  ): Promise<TokenGrant>
  refreshAccessToken(refreshToken: string): Promise<AccessToken>
  /**
   * Revokes the grant at Google (RF11.9). Never throws: local tokens are deleted whatever the
   * answer, and "failed" is reported so the user can also revoke on the Google account page.
   */
  revoke(token: string): Promise<RevokeResult>
}

export type RevokeResult = "revoked" | "already_revoked" | "failed"

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().optional(),
})

const errorResponseSchema = z.object({ error: z.string() }).loose()

type FetchLike = typeof fetch

export type GoogleOAuthConfig = {
  clientId: string
  clientSecret: string
  fetch?: FetchLike
  now?: () => Date
}

export function createGoogleOAuthClient(
  config: GoogleOAuthConfig
): GoogleOAuthClient {
  const doFetch = config.fetch ?? fetch
  const now = config.now ?? (() => new Date())

  async function postForm(
    url: string,
    body: Record<string, string>
  ): Promise<unknown> {
    const response = await doFetch(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
      signal: AbortSignal.timeout(OAUTH_TIMEOUT_MS),
    })
    const json: unknown = await response.json().catch(() => ({}))
    if (!response.ok) {
      const error = errorResponseSchema.safeParse(json)
      const code =
        error.success && error.data.error === "invalid_grant"
          ? "invalid_grant"
          : "http_error"
      throw new GoogleOAuthError(
        code,
        `Google OAuth answered ${response.status}`
      )
    }
    return json
  }

  function parseToken(json: unknown): z.infer<typeof tokenResponseSchema> {
    const parsed = tokenResponseSchema.safeParse(json)
    if (!parsed.success)
      throw new GoogleOAuthError(
        "invalid_response",
        "Unexpected token response"
      )
    return parsed.data
  }

  return {
    authorizationUrl(request) {
      const params = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: request.redirectUri,
        response_type: "code",
        scope: request.scope,
        access_type: "offline",
        include_granted_scopes: "true",
        prompt: "consent",
        state: request.state,
        code_challenge: request.codeChallenge,
        code_challenge_method: "S256",
      })
      if (request.loginHint) params.set("login_hint", request.loginHint)
      return `${GOOGLE_AUTH_URL}?${params.toString()}`
    },

    async exchangeCode(code, codeVerifier, redirectUri) {
      const token = parseToken(
        await postForm(GOOGLE_TOKEN_URL, {
          code,
          code_verifier: codeVerifier,
          client_id: config.clientId,
          client_secret: config.clientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        })
      )
      return {
        accessToken: token.access_token,
        expiresAt: new Date(now().getTime() + token.expires_in * 1000),
        refreshToken: token.refresh_token ?? null,
        scopes: (token.scope ?? "").split(/\s+/).filter(Boolean),
      }
    },

    async refreshAccessToken(refreshToken) {
      const token = parseToken(
        await postForm(GOOGLE_TOKEN_URL, {
          refresh_token: refreshToken,
          client_id: config.clientId,
          client_secret: config.clientSecret,
          grant_type: "refresh_token",
        })
      )
      return {
        accessToken: token.access_token,
        expiresAt: new Date(now().getTime() + token.expires_in * 1000),
      }
    },

    async revoke(token) {
      try {
        const response = await doFetch(GOOGLE_REVOKE_URL, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token }).toString(),
          signal: AbortSignal.timeout(OAUTH_TIMEOUT_MS),
        })
        if (response.ok) return "revoked"
        // 400 invalid_token: already revoked at Google (e.g. from the account page).
        return response.status === 400 ? "already_revoked" : "failed"
      } catch {
        return "failed"
      }
    },
  }
}
