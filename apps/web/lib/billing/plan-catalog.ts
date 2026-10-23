import type { getTranslations } from "next-intl/server"

export type PlanCatalogId = "free" | "pro" | "executive" | "search_pass"

export type PlanCatalogEntry = {
  id: PlanCatalogId
  name: string
  priceMonth: string
  priceYear: string | null
  features: string[]
  purchasable: boolean
}

function planMessages(
  t: Awaited<ReturnType<typeof getTranslations<"Billing">>>,
  id: PlanCatalogId
): PlanCatalogEntry {
  switch (id) {
    case "free":
      return {
        id,
        name: t("plans.free.name"),
        priceMonth: t("plans.free.price"),
        priceYear: null,
        features: t.raw("plans.free.features") as string[],
        purchasable: false,
      }
    case "pro":
      return {
        id,
        name: t("plans.pro.name"),
        priceMonth: t("plans.pro.price"),
        priceYear: t("plans.pro.priceYear"),
        features: t.raw("plans.pro.features") as string[],
        purchasable: true,
      }
    case "executive":
      return {
        id,
        name: t("plans.executive.name"),
        priceMonth: t("plans.executive.price"),
        priceYear: t("plans.executive.priceYear"),
        features: t.raw("plans.executive.features") as string[],
        purchasable: true,
      }
    case "search_pass":
      return {
        id,
        name: t("plans.search_pass.name"),
        priceMonth: t("plans.search_pass.price"),
        priceYear: null,
        features: t.raw("plans.search_pass.features") as string[],
        purchasable: true,
      }
    default: {
      const unreachable: never = id
      throw new Error(`Unknown plan: ${String(unreachable)}`)
    }
  }
}

export async function buildPlanCatalog(
  t: Awaited<ReturnType<typeof getTranslations<"Billing">>>
): Promise<PlanCatalogEntry[]> {
  const ids: PlanCatalogId[] = ["free", "pro", "executive", "search_pass"]
  return ids.map((id) => planMessages(t, id))
}
