import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

import {
  DEV_SESSION_COOKIE,
  devUser,
  isDevAuthBypassEnabled,
} from "@/lib/auth/dev-bypass"
import { redirectRelative } from "@/lib/http"
import { getSupabasePublicEnv } from "@/lib/supabase/env"
import { safeNextPath } from "@/lib/url"

/**
 * Dev-only: starts a session as the fictitious seed user. 404 unless the bypass is enabled.
 * With the local Supabase stack it also signs in for real, so data reads run under her RLS.
 */
export async function GET(request: NextRequest) {
  if (!isDevAuthBypassEnabled()) {
    return new NextResponse(null, { status: 404 })
  }

  const response = redirectRelative(
    safeNextPath(request.nextUrl.searchParams.get("next"), "/app")
  )

  const env = getSupabasePublicEnv()
  if (env) {
    const supabase = createServerClient(env.url, env.publishableKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options)
          }
        },
      },
    })
    await supabase.auth.signInWithPassword({
      email: devUser.email,
      password: devUser.password,
    })
  }

  response.cookies.set(DEV_SESSION_COOKIE, "1", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  })
  return response
}
