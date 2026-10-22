import { getTranslations } from "next-intl/server"

import { CredentialsForm } from "@/components/auth/credentials-form"
import { getSupabasePublicEnv } from "@/lib/supabase/env"
import { safeNextPath } from "@/lib/url"

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const t = await getTranslations("Auth.errors")
  const next = safeNextPath(params.next, "/app")

  const initialError = !getSupabasePublicEnv()
    ? t("not_configured")
    : params.erro === "link_invalid"
      ? t("link_invalid")
      : undefined

  return (
    <CredentialsForm mode="login" next={next} initialError={initialError} />
  )
}
