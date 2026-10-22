import { createServerClient } from "@supabase/ssr"
import type { SupabaseClient } from "@supabase/supabase-js"
import { cookies } from "next/headers"

import { getSupabasePublicEnv } from "./env"

/**
 * Per-request Supabase client for Server Components, Server Actions and Route Handlers.
 * Uses the user's cookie session, so every query runs under RLS. Returns null when Supabase
 * is not configured (local dev without `supabase start`).
 */
export async function createSupabaseServerClient(): Promise<SupabaseClient | null> {
  const env = getSupabasePublicEnv()
  if (!env) return null
  const cookieStore = await cookies()

  return createServerClient(env.url, env.publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options)
          }
        } catch {
          // Server Components cannot write cookies; proxy.ts refreshes the session instead.
        }
      },
    },
  })
}
