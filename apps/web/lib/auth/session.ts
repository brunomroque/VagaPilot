import { cookies } from "next/headers"

import {
  SIGNUP_REQUIRED_LEGAL_DOCS,
  signupLegalComplete,
  type LegalSlug,
} from "@vagapilot/core/legal"

import {
  latestByDocument,
  loadCurrentLegalDocuments,
  loadEvidence,
} from "@/lib/legal/server"
import { getAdminClient } from "@/lib/server/admin"
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
  firstName: string
  isDevBypass: boolean
}

/** Legacy consents.version written alongside legal_acceptances on signup. */
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
        firstName: devUser.displayName.split(/\s+/)[0] ?? devUser.displayName,
        isDevBypass: true,
      }
    }
  }

  const supabase = await createSupabaseServerClient()
  if (!supabase) return null

  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) return null

  const metadata = data.user.user_metadata as Record<string, unknown>
  const firstName =
    typeof metadata.first_name === "string" && metadata.first_name.trim()
      ? metadata.first_name.trim()
      : null
  const fromMetadata =
    typeof metadata.display_name === "string"
      ? metadata.display_name
      : typeof metadata.full_name === "string"
        ? metadata.full_name
        : firstName

  const displayName = fromMetadata ?? data.user.email?.split("@")[0] ?? ""
  const greetingName = firstName ?? displayName.split(/\s+/)[0] ?? displayName

  return {
    id: data.user.id,
    email: data.user.email ?? "",
    displayName,
    firstName: greetingName,
    isDevBypass: false,
  }
}

/** Inserts legacy consents rows (P0.3) after legal signup docs are accepted. */
export async function recordLegacySignupConsents(
  user: CurrentUser
): Promise<void> {
  if (user.isDevBypass) return
  const supabase = await createSupabaseServerClient()
  if (!supabase) return

  const { data: existing } = await supabase
    .from("consents")
    .select("purpose")
    .eq("user_id", user.id)
    .eq("version", TERMS_VERSION)
    .in("purpose", [...REQUIRED_CONSENTS])
    .eq("granted", true)
  const have = new Set(
    (existing ?? []).map((r: { purpose: string }) => r.purpose)
  )
  const missing = REQUIRED_CONSENTS.filter((p) => !have.has(p))
  if (missing.length === 0) return

  await supabase.from("consents").insert(
    missing.map((purpose) => ({
      user_id: user.id,
      purpose,
      version: TERMS_VERSION,
      granted: true,
    }))
  )
}

/**
 * True when the user accepted every signup-required legal document at its current version/hash.
 * Fail-open only if legal documents cannot be loaded (missing admin client or DB error), so users
 * are not locked out by infrastructure failures.
 */
export async function hasAcceptedTerms(user: CurrentUser): Promise<boolean> {
  if (user.isDevBypass) return true

  if (!getAdminClient()) {
    console.error(
      "[hasAcceptedTerms] admin client unavailable; treating as accepted (fail-open)"
    )
    return true
  }

  const [docs, rows] = await Promise.all([
    loadCurrentLegalDocuments(),
    loadEvidence(user.id),
  ])

  const current: Partial<
    Record<LegalSlug, { version: string; sha256: string }>
  > = {}
  for (const slug of SIGNUP_REQUIRED_LEGAL_DOCS) {
    const d = docs[slug]
    if (d) current[slug] = { version: d.version, sha256: d.sha256 }
  }

  const requiredLoaded = SIGNUP_REQUIRED_LEGAL_DOCS.filter((s) => current[s])
  if (requiredLoaded.length === 0) {
    console.error(
      "[hasAcceptedTerms] no current legal documents loaded; treating as accepted (fail-open)"
    )
    return true
  }

  const latest = latestByDocument(rows)
  return signupLegalComplete(latest, current)
}
