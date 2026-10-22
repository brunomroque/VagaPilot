export type SupabasePublicEnv = {
  url: string
  publishableKey: string
}

/** Public (browser-safe) Supabase settings. The service role key is never read here. */
export function getSupabasePublicEnv(): SupabasePublicEnv | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !publishableKey) return null
  return { url, publishableKey }
}
