import { PublicLegalPage } from "@/components/risk/public-legal-page"

export const dynamic = "force-dynamic"

export default function TermsPage() {
  return <PublicLegalPage slug="termos-de-uso" fallback="termsTitle" />
}
