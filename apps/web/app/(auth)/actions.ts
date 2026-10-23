"use server"

import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { getTranslations } from "next-intl/server"

import { DEV_SESSION_COOKIE } from "@/lib/auth/dev-bypass"
import {
  credentialsSchema,
  type AuthActionResult,
  type AuthErrorCode,
} from "@/lib/auth/schemas"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { getAppOrigin, safeNextPath } from "@/lib/url"

async function failure(code: AuthErrorCode): Promise<AuthActionResult> {
  const t = await getTranslations("Auth.errors")
  return { error: { code, message: t(code) } }
}

async function appOriginOrError(): Promise<string | AuthActionResult> {
  try {
    return await getAppOrigin()
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("public_app_url:")) {
      return failure("public_url")
    }
    throw error
  }
}

function codeFromSupabase(
  code: string | undefined,
  status: number | undefined
): AuthErrorCode {
  if (code === "email_not_confirmed") return "email_not_confirmed"
  if (code === "invalid_credentials") return "invalid_credentials"
  if (code === "weak_password") return "weak_password"
  if (
    status === 429 ||
    code === "over_request_rate_limit" ||
    code === "over_email_send_rate_limit"
  ) {
    return "rate_limited"
  }
  return "unknown"
}

export async function signInWithPassword(
  input: unknown,
  next?: string
): Promise<AuthActionResult> {
  const parsed = credentialsSchema.safeParse(input)
  if (!parsed.success) return failure("invalid_input")

  const supabase = await createSupabaseServerClient()
  if (!supabase) return failure("not_configured")

  const { error } = await supabase.auth.signInWithPassword(parsed.data)
  if (error) {
    const code = codeFromSupabase(error.code, error.status)
    return failure(code === "unknown" ? "invalid_credentials" : code)
  }

  redirect(safeNextPath(next, "/app"))
}

export async function signUpWithPassword(
  input: unknown
): Promise<AuthActionResult> {
  const parsed = credentialsSchema.safeParse(input)
  if (!parsed.success) return failure("invalid_input")

  const supabase = await createSupabaseServerClient()
  if (!supabase) return failure("not_configured")

  const origin = await appOriginOrError()
  if (typeof origin !== "string") return origin
  const { data, error } = await supabase.auth.signUp({
    ...parsed.data,
    options: { emailRedirectTo: `${origin}/auth/callback?next=/aceite` },
  })
  if (error) return failure(codeFromSupabase(error.code, error.status))

  // Without a session the address still needs confirming. The same screen is shown for
  // already-registered addresses so the form does not reveal who has an account.
  redirect(data.session ? "/aceite" : "/cadastro/verifique")
}

export async function signInWithGoogle(
  next?: string
): Promise<AuthActionResult> {
  const supabase = await createSupabaseServerClient()
  if (!supabase) return failure("not_configured")

  const origin = await appOriginOrError()
  if (typeof origin !== "string") return origin
  const destination = safeNextPath(next, "/app")
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(destination)}`,
      // Login only. Gmail scopes are requested later in a separate, incremental consent.
      scopes: "openid email profile",
    },
  })
  if (error || !data.url) return failure("google_unavailable")

  redirect(data.url)
}

export async function signOut(): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.delete(DEV_SESSION_COOKIE)

  const supabase = await createSupabaseServerClient()
  if (supabase) await supabase.auth.signOut()

  redirect("/entrar")
}
