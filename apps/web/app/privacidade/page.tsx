import { PublicLegalPage } from "@/components/risk/public-legal-page"

export const dynamic = "force-dynamic"

export default function PrivacyPage() {
  return <PublicLegalPage slug="politica-de-privacidade" fallback="privacyTitle" />
}
