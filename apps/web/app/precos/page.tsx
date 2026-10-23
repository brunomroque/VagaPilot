import Link from "next/link"
import { getTranslations } from "next-intl/server"

import { Brand } from "@/components/brand"
import { PublicPlanCards } from "@/components/billing/public-plan-cards"
import { buttonVariants } from "@workspace/ui/components/button"

export default async function PublicPricingPage() {
  const t = await getTranslations("Billing")
  const home = await getTranslations("Home")

  return (
    <main className="mx-auto flex min-h-svh max-w-6xl flex-col gap-10 p-6 pb-16">
      <header className="flex flex-col items-center gap-4 text-center">
        <Link href="/" className="inline-flex">
          <Brand />
        </Link>
        <div className="flex max-w-2xl flex-col gap-2">
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
            {t("title")}
          </h1>
          <p className="text-muted-foreground">{t("subtitle")}</p>
          <p className="text-xs text-muted-foreground">{t("legalDraft")}</p>
        </div>
      </header>
      <PublicPlanCards />
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link href="/cadastro" className={buttonVariants({ size: "lg" })}>
          {home("signUp")}
        </Link>
        <Link
          href="/entrar"
          className={buttonVariants({ size: "lg", variant: "outline" })}
        >
          {home("signIn")}
        </Link>
      </div>
    </main>
  )
}
