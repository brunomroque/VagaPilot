import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

import {
  DEV_SESSION_COOKIE,
  isDevAuthBypassEnabled,
} from "@/lib/auth/dev-bypass"
import { getSupabasePublicEnv } from "./env"

const PROTECTED_PREFIX = "/app"
const GUEST_ONLY = ["/entrar", "/cadastro"]

function isProtected(pathname: string) {
  return (
    pathname === PROTECTED_PREFIX || pathname.startsWith(`${PROTECTED_PREFIX}/`)
  )
}

/**
 * Proxy redirects must be absolute. Keep the loopback alias the browser used (127.0.0.1 vs
 * localhost) so cookies set for that host are sent on the next request.
 */
function sameHostUrl(request: NextRequest, pathWithQuery: string) {
  const url = new URL(pathWithQuery, request.nextUrl.origin)
  const host = request.headers.get("host")
  if (host && /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host))
    url.host = host
  return url
}

function redirectTo(
  request: NextRequest,
  pathname: string,
  carry?: NextResponse
) {
  const query =
    pathname === "/entrar"
      ? `?${new URLSearchParams({ next: `${request.nextUrl.pathname}${request.nextUrl.search}` })}`
      : ""
  const response = NextResponse.redirect(
    sameHostUrl(request, `${pathname}${query}`)
  )
  if (carry) {
    for (const cookie of carry.cookies.getAll()) response.cookies.set(cookie)
    for (const header of ["cache-control", "expires", "pragma"]) {
      const value = carry.headers.get(header)
      if (value) response.headers.set(header, value)
    }
  }
  return response
}

/** Refreshes the Supabase session cookie and guards /app/*. */
export async function updateSession(request: NextRequest) {
  const { pathname } = request.nextUrl

  const devBypass =
    isDevAuthBypassEnabled() &&
    request.cookies.get(DEV_SESSION_COOKIE)?.value === "1"

  const env = getSupabasePublicEnv()
  if (devBypass && !env) return NextResponse.next({ request })
  if (!env) {
    return isProtected(pathname)
      ? redirectTo(request, "/entrar")
      : NextResponse.next({ request })
  }

  let response = NextResponse.next({ request })

  const supabase = createServerClient(env.url, env.publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet)
          request.cookies.set(name, value)
        response = NextResponse.next({ request })
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options)
        }
        for (const [key, value] of Object.entries(headers))
          response.headers.set(key, value)
      },
    },
  })

  // getClaims() verifies the JWT; never trust getSession() on the server.
  const { data } = await supabase.auth.getClaims()
  const signedIn = Boolean(data?.claims?.sub)

  // The dev session keeps its Supabase tokens fresh here but never redirects.
  if (devBypass) return response
  if (!signedIn && isProtected(pathname))
    return redirectTo(request, "/entrar", response)
  if (signedIn && GUEST_ONLY.includes(pathname))
    return redirectTo(request, "/app", response)

  return response
}
