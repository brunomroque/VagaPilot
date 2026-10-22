import "server-only"

import { createClient, type SupabaseClient } from "@supabase/supabase-js"

let admin: SupabaseClient | null | undefined

/**
 * service_role client for server-only tables (`user_keys`), audit writes and jobs.
 * Never use it for user data reads: those go through the user's RLS session.
 */
export function getAdminClient(): SupabaseClient | null {
  if (admin !== undefined) return admin
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  admin =
    url && key
      ? createClient(url, key, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
      : null
  return admin
}
