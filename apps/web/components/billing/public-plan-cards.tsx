import Link from "next/link"
import { getTranslations } from "next-intl/server"

import { buildPlanCatalog } from "@/lib/billing/plan-catalog"
import { buttonVariants } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"

export async function PublicPlanCards() {
  const t = await getTranslations("Billing")
  const plans = await buildPlanCatalog(t)

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {plans.map((plan) => (
        <Card
          key={plan.id}
          className={plan.id === "pro" ? "border-primary" : undefined}
        >
          <CardHeader>
            <CardTitle>{plan.name}</CardTitle>
            <CardDescription>{plan.priceMonth}</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="list-inside list-disc text-sm text-muted-foreground">
              {plan.features.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </CardContent>
          <CardFooter>
            {plan.purchasable ? (
              <Link
                href="/cadastro"
                className={buttonVariants({ className: "w-full" })}
              >
                {t("publicCta")}
              </Link>
            ) : (
              <p className="text-sm text-muted-foreground">{t("freeNote")}</p>
            )}
          </CardFooter>
        </Card>
      ))}
    </div>
  )
}
