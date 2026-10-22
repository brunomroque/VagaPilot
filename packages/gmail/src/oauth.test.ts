import { createHash } from "node:crypto"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  createGoogleOAuthClient,
  createOAuthState,
  createPkcePair,
  GoogleOAuthError,
  GOOGLE_TOKEN_URL,
  statesMatch,
} from "./oauth.js"
import {
  GMAIL_READONLY_SCOPE,
  GMAIL_SEND_SCOPE,
  hasScope,
  scopeForKind,
} from "./scopes.js"

type Call = { url: string; body: URLSearchParams }

function fakeFetch(responses: { status: number; json: unknown }[]) {
  const calls: Call[] = []
  const fn = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: String(input),
        body: new URLSearchParams(String(init?.body ?? "")),
      })
      const next = responses.shift() ?? { status: 500, json: {} }
      return new Response(JSON.stringify(next.json), { status: next.status })
    }
  )
  return { fn: fn as unknown as typeof fetch, calls }
}

beforeEach(() => {
  vi.stubGlobal("fetch", () => {
    throw new Error("Real network is not allowed in tests")
  })
})
afterEach(() => vi.unstubAllGlobals())

describe("P4.1 OAuth with state + PKCE", () => {
  it("creates an S256 PKCE pair and random states", () => {
    const { verifier, challenge } = createPkcePair()
    expect(verifier.length).toBeGreaterThanOrEqual(43)
    expect(challenge).toBe(
      createHash("sha256").update(verifier).digest("base64url")
    )
    expect(createOAuthState()).not.toBe(createOAuthState())
    const state = createOAuthState()
    expect(statesMatch(state, state)).toBe(true)
    expect(statesMatch(state, `${state}x`)).toBe(false)
    expect(statesMatch("", "")).toBe(false)
  })

  it("asks for gmail.readonly and gmail.send separately, incrementally and offline", () => {
    const client = createGoogleOAuthClient({
      clientId: "id-ficticio",
      clientSecret: "segredo",
    })
    const read = new URL(
      client.authorizationUrl({
        redirectUri: "http://127.0.0.1:3100/api/google/oauth/callback",
        scope: scopeForKind("leitura"),
        state: "estado",
        codeChallenge: "desafio",
        loginHint: "marina@vagapilot.test",
      })
    )
    expect(read.searchParams.get("scope")).toBe(GMAIL_READONLY_SCOPE)
    expect(read.searchParams.get("include_granted_scopes")).toBe("true")
    expect(read.searchParams.get("access_type")).toBe("offline")
    expect(read.searchParams.get("code_challenge_method")).toBe("S256")
    expect(read.searchParams.get("state")).toBe("estado")

    const send = new URL(
      client.authorizationUrl({
        redirectUri: "http://127.0.0.1:3100/api/google/oauth/callback",
        scope: scopeForKind("envio"),
        state: "s",
        codeChallenge: "c",
      })
    )
    expect(send.searchParams.get("scope")).toBe(GMAIL_SEND_SCOPE)
    expect(hasScope([GMAIL_READONLY_SCOPE], "envio")).toBe(false)
  })

  it("exchanges the code with the verifier and reads granted scopes", async () => {
    const { fn, calls } = fakeFetch([
      {
        status: 200,
        json: {
          access_token: "acesso",
          expires_in: 3600,
          refresh_token: "renovacao-ficticia",
          scope: `${GMAIL_READONLY_SCOPE} openid`,
        },
      },
    ])
    const client = createGoogleOAuthClient({
      clientId: "id",
      clientSecret: "segredo",
      fetch: fn,
      now: () => new Date("2026-10-22T12:00:00Z"),
    })
    const grant = await client.exchangeCode(
      "codigo",
      "verificador",
      "http://127.0.0.1/cb"
    )
    expect(grant).toEqual({
      accessToken: "acesso",
      expiresAt: new Date("2026-10-22T13:00:00Z"),
      refreshToken: "renovacao-ficticia",
      scopes: [GMAIL_READONLY_SCOPE, "openid"],
    })
    expect(calls[0]?.url).toBe(GOOGLE_TOKEN_URL)
    expect(calls[0]?.body.get("code_verifier")).toBe("verificador")
    expect(calls[0]?.body.get("grant_type")).toBe("authorization_code")
  })

  it("reports invalid_grant on refresh and tolerates already-revoked tokens", async () => {
    const { fn } = fakeFetch([
      { status: 400, json: { error: "invalid_grant" } },
      { status: 400, json: { error: "invalid_token" } },
      { status: 200, json: {} },
    ])
    const client = createGoogleOAuthClient({
      clientId: "id",
      clientSecret: "s",
      fetch: fn,
    })
    await expect(client.refreshAccessToken("velho")).rejects.toMatchObject(
      new GoogleOAuthError("invalid_grant", "Google OAuth answered 400")
    )
    await expect(client.revoke("velho")).resolves.toBe("already_revoked")
    await expect(client.revoke("token")).resolves.toBe("revoked")
  })
})
