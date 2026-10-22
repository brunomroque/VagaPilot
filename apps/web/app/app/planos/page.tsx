import Link from "next/link"
import { getTranslations } from "next-intl/server"

import { buttonVariants } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"

export default async function PlansPage() {
  const t = await getTranslations("Billing")

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8 p-6">
      <header className="text-center">
        <h1 className="text-3xl font-extrabold tracking-tight">{t("title")}</h1>
        <p className="mt-2 text-muted-foreground">{t("subtitle")}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t("legalDraft")}</p>
      </header>
      <div className="grid gap-4 md:grid-cols-3">
        {(["free", "pro", "executive"] as const).map((plan) => (
          <Card
            key={plan}
            className={plan === "pro" ? "border-primary" : undefined}
          >
            <CardHeader>
              <CardTitle>{t(`plans.${plan}.name`)}</CardTitle>
              <CardDescription>{t(`plans.${plan}.price`)}</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="list-inside list-disc text-sm text-muted-foreground">
                {(t.raw(`plans.${plan}.features`) as string[]).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </CardContent>
            {plan !== "free" ? (
              <CardFooter>
                <Link
                  href="/app/configuracoes"
                  className={buttonVariants({ className: "w-full" })}
                >
                  {t("cta")}
                </Link>
              </CardFooter>
            ) : null}
          </Card>
        ))}
      </div>
    </div>
  )
}
