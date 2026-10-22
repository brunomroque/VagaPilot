import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { ActionError } from "@/lib/action-result"
import { getCurrentUser, type CurrentUser } from "@/lib/auth/session"
import { createSupabaseServerClient } from "@/lib/supabase/server"

export {
  fail,
  ok,
  type ActionError,
  type ActionErrorCode,
  type ActionResult,
} from "@/lib/action-result"

export type UserContext = { user: CurrentUser; supabase: SupabaseClient }

/**
 * Current user plus a Supabase client bound to their session, so every query runs under RLS.
 * The dev bypass signs in as the fictitious seed user, so it also gets a real session.
 */
export async function getUserContext(): Promise<
  { ok: true; ctx: UserContext } | { ok: false; error: ActionError }
> {
  const user = await getCurrentUser()
  if (!user) {
    return {
      ok: false,
      error: { code: "unauthorized", message: "Sign in first." },
    }
  }
  const supabase = await createSupabaseServerClient()
  if (!supabase) {
    return {
      ok: false,
      error: { code: "not_configured", message: "Supabase is not configured." },
    }
  }
  const { data } = await supabase.auth.getClaims()
  if (data?.claims?.sub !== user.id) {
    return {
      ok: false,
      error: {
        code: "unauthorized",
        message: "No database session for this user.",
      },
    }
  }
  return { ok: true, ctx: { user, supabase } }
}
