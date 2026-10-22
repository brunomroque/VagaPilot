import { NextResponse, type NextRequest } from "next/server"

import { consentRequestSchema } from "@/lib/auth/schemas"
import { getCurrentUser } from "@/lib/auth/session"
import { apiError } from "@/lib/http"
import { createSupabaseServerClient } from "@/lib/supabase/server"

/** Records terms/privacy acceptance in `consents` (spec P0.3). Runs under the user's RLS session. */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user)
    return apiError("unauthorized", "Sign in to accept the terms.", 401)

  const body: unknown = await request.json().catch(() => null)
  const parsed = consentRequestSchema.safeParse(body)
  if (!parsed.success)
    return apiError("invalid_request", "Invalid consent payload.", 400)

  if (user.isDevBypass) return NextResponse.json({ ok: true }, { status: 201 })

  const supabase = await createSupabaseServerClient()
  if (!supabase)
    return apiError("not_configured", "Supabase is not configured.", 503)

  const { error } = await supabase.from("consents").insert(
    parsed.data.purposes.map((purpose) => ({
      user_id: user.id,
      purpose,
      version: parsed.data.version,
      granted: true,
    }))
  )
  if (error) return apiError("internal_error", "Could not record consent.", 500)

  return NextResponse.json({ ok: true }, { status: 201 })
}
