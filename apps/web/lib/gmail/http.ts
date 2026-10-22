import "server-only"

import type { NextRequest } from "next/server"

import { redirectRelative } from "@/lib/http"

/**
 * Origin the browser used (Host header), so 127.0.0.1 and localhost are never mixed: the OAuth
 * cookie only comes back to the host that set it.
 */
export function requestOrigin(request: NextRequest): string {
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host")
  if (!host) return request.nextUrl.origin
  const protocol =
    request.headers.get("x-forwarded-proto") ??
    request.nextUrl.protocol.replace(/:$/, "")
  return `${protocol}://${host}`
}

/** Callback registered in Google Cloud; defaults to this app's own route. */
export function gmailRedirectUri(request: NextRequest): string {
  const configured = process.env.GOOGLE_GMAIL_REDIRECT_URI?.trim()
  return configured || `${requestOrigin(request)}/api/google/oauth/callback`
}

/**
 * Origin check for the OAuth start (P4.1): browsers send `Sec-Fetch-Site`; a cross-site page
 * must not be able to start a connection for the signed-in user. Direct navigation is "none".
 */
export function isSameSiteNavigation(request: NextRequest): boolean {
  const site = request.headers.get("sec-fetch-site")
  if (site && site !== "same-origin" && site !== "none") return false
  const referer = request.headers.get("referer")
  if (!referer) return true
  try {
    return new URL(referer).origin === requestOrigin(request)
  } catch {
    return false
  }
}

/** CSRF check for state-changing API calls (12: SameSite=Lax + origin). */
export function hasSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin")
  return origin !== null && origin === requestOrigin(request)
}

export function settingsRedirect(params: Record<string, string>) {
  return redirectRelative(
    `/app/configuracoes?${new URLSearchParams(params).toString()}`
  )
}
