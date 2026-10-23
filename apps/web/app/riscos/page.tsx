import { PublicLegalPage } from "@/components/risk/public-legal-page"

export const dynamic = "force-dynamic"

export default function RisksTermPage() {
  return <PublicLegalPage slug="termo-riscos-automacao" fallback="termsTitle" />
}
