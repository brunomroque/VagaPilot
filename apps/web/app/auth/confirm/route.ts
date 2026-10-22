import type { EmailOtpType } from "@supabase/supabase-js"
import type { NextRequest } from "next/server"
import { z } from "zod"

import { redirectRelative } from "@/lib/http"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { safeNextPath } from "@/lib/url"

const confirmQuerySchema = z.object({
  token_hash: z.string().min(1),
  type: z.enum([
    "signup",
    "email",
    "recovery",
    "invite",
    "magiclink",
    "email_change",
  ]),
})

/** Token-hash confirmation (custom e-mail templates pointing at {{ .SiteURL }}/auth/confirm). */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const parsed = confirmQuerySchema.safeParse({
    token_hash: searchParams.get("token_hash"),
    type: searchParams.get("type"),
  })
  const next = safeNextPath(searchParams.get("next"), "/aceite")

  const supabase = await createSupabaseServerClient()
  if (parsed.success && supabase) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: parsed.data.token_hash,
      type: parsed.data.type satisfies EmailOtpType,
    })
    if (!error) return redirectRelative(next)
  }

  return redirectRelative("/entrar?erro=link_invalid")
}
