import { getTranslations } from "next-intl/server"

import { CredentialsForm } from "@/components/auth/credentials-form"
import { getSupabasePublicEnv } from "@/lib/supabase/env"

export default async function SignUpPage() {
  const t = await getTranslations("Auth.errors")
  const initialError = getSupabasePublicEnv() ? undefined : t("not_configured")

  return <CredentialsForm mode="signup" initialError={initialError} />
}
