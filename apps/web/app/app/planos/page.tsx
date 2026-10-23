import { getTranslations } from "next-intl/server"

import { PlanCards } from "@/components/billing/plan-cards"
import { buildPlanCatalog } from "@/lib/billing/plan-catalog"

export default async function PlansPage({
  searchParams,
}: {
  searchParams: Promise<{ billing?: string }>
}) {
  const t = await getTranslations("Billing")
  const billing = (await searchParams).billing
  const notice =
    billing === "success"
      ? t("notices.success")
      : billing === "cancel"
        ? t("notices.cancel")
        : null

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 p-6">
      <header className="text-center">
        <h1 className="text-3xl font-extrabold tracking-tight">{t("title")}</h1>
        <p className="mt-2 text-muted-foreground">{t("subtitle")}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t("legalDraft")}</p>
      </header>
      <PlanCards plans={await buildPlanCatalog(t)} notice={notice} />
    </div>
  )
}
