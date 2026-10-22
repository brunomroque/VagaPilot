import { cookies } from "next/headers"

import { createSupabaseServerClient } from "@/lib/supabase/server"

import {
  DEV_SESSION_COOKIE,
  devUser,
  isDevAuthBypassEnabled,
} from "./dev-bypass"

export type CurrentUser = {
  id: string
  email: string
  displayName: string
  isDevBypass: boolean
}

export const TERMS_VERSION = "v1"
export const REQUIRED_CONSENTS = ["termos", "privacidade"] as const

export async function getCurrentUser(): Promise<CurrentUser | null> {
  if (isDevAuthBypassEnabled()) {
    const cookieStore = await cookies()
    if (cookieStore.get(DEV_SESSION_COOKIE)?.value === "1") {
      return {
        id: devUser.id,
        email: devUser.email,
        displayName: devUser.displayName,
        isDevBypass: true,
      }
    }
  }

  const supabase = await createSupabaseServerClient()
  if (!supabase) return null

  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) return null

  const metadata = data.user.user_metadata as Record<string, unknown>
  const fromMetadata =
    typeof metadata.display_name === "string"
      ? metadata.display_name
      : typeof metadata.full_name === "string"
        ? metadata.full_name
        : null

  return {
    id: data.user.id,
    email: data.user.email ?? "",
    displayName: fromMetadata ?? data.user.email?.split("@")[0] ?? "",
    isDevBypass: false,
  }
}

/** True when the user granted every required consent at the current terms version. */
export async function hasAcceptedTerms(user: CurrentUser): Promise<boolean> {
  if (user.isDevBypass) return true
  const supabase = await createSupabaseServerClient()
  if (!supabase) return false

  const { data, error } = await supabase
    .from("consents")
    .select("purpose, granted, created_at")
    .eq("version", TERMS_VERSION)
    .in("purpose", [...REQUIRED_CONSENTS])
    .order("created_at", { ascending: false })
  if (error || !data) return false

  const latest = new Map<string, boolean>()
  for (const row of data as { purpose: string; granted: boolean }[]) {
    if (!latest.has(row.purpose)) latest.set(row.purpose, row.granted)
  }
  return REQUIRED_CONSENTS.every((purpose) => latest.get(purpose) === true)
}
