import type { NextRequest } from "next/server"

import { redirectRelative } from "@/lib/http"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { safeNextPath } from "@/lib/url"

/** PKCE return point for Google login and e-mail confirmation links. */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const code = searchParams.get("code")
  const next = safeNextPath(searchParams.get("next"), "/app")

  const supabase = await createSupabaseServerClient()
  if (code && supabase) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) return redirectRelative(next)
  }

  return redirectRelative("/entrar?erro=link_invalid")
}
