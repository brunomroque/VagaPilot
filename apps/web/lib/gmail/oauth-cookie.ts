import "server-only"

import { z } from "zod"

import { GMAIL_SCOPE_KINDS } from "@vagapilot/gmail"

/**
 * Short-lived OAuth transaction (state + PKCE verifier) in an httpOnly, SameSite=Lax cookie
 * scoped to /api/google/oauth. Bound to the user who started it and to its redirect URI.
 */
export const GMAIL_OAUTH_COOKIE = "vp_gmail_oauth"
export const GMAIL_OAUTH_COOKIE_PATH = "/api/google/oauth"
export const GMAIL_OAUTH_TTL_SECONDS = 10 * 60

const transactionSchema = z.object({
  state: z.string().min(32),
  verifier: z.string().min(43),
  kind: z.enum(GMAIL_SCOPE_KINDS),
  userId: z.uuid(),
  redirectUri: z.url(),
  createdAt: z.number().int(),
})

export type GmailOAuthTransaction = z.infer<typeof transactionSchema>

export function encodeTransaction(transaction: GmailOAuthTransaction): string {
  return Buffer.from(JSON.stringify(transaction), "utf8").toString("base64url")
}

export function decodeTransaction(
  value: string | undefined,
  now = Date.now()
): GmailOAuthTransaction | null {
  if (!value) return null
  try {
    const parsed = transactionSchema.safeParse(
      JSON.parse(Buffer.from(value, "base64url").toString("utf8"))
    )
    if (!parsed.success) return null
    if (now - parsed.data.createdAt > GMAIL_OAUTH_TTL_SECONDS * 1000)
      return null
    return parsed.data
  } catch {
    return null
  }
}

export function cookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: GMAIL_OAUTH_COOKIE_PATH,
    maxAge: GMAIL_OAUTH_TTL_SECONDS,
  }
}
