import { redirect } from "next/navigation"

import { ConsentForm } from "@/components/auth/consent-form"
import {
  getCurrentUser,
  hasAcceptedTerms,
  TERMS_VERSION,
} from "@/lib/auth/session"
import { safeNextPath } from "@/lib/url"

export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const user = await getCurrentUser()
  if (!user) redirect("/entrar?next=/aceite")

  // J1: right after the terms, new users go through onboarding (it ends in /app/chat).
  const next = safeNextPath((await searchParams).next, "/app/onboarding")
  if (await hasAcceptedTerms(user)) redirect(next)

  return <ConsentForm version={TERMS_VERSION} next={next} />
}
