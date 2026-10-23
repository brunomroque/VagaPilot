import Link from "next/link"
import { getTranslations } from "next-intl/server"

import { Brand } from "@/components/brand"
import { buttonVariants } from "@workspace/ui/components/button"

export default async function HomePage() {
  const t = await getTranslations("Home")

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-8 p-6 text-center">
      <Brand />
      <div className="flex max-w-lg flex-col gap-3">
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
          {t("tagline")}
        </h1>
        <p className="text-muted-foreground">{t("body")}</p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link href="/cadastro" className={buttonVariants({ size: "lg" })}>
          {t("signUp")}
        </Link>
        <Link
          href="/entrar"
          className={buttonVariants({ size: "lg", variant: "outline" })}
        >
          {t("signIn")}
        </Link>
      </div>
      <nav className="flex flex-wrap justify-center gap-4 text-sm text-muted-foreground">
        <Link href="/precos" className="underline-offset-4 hover:underline">
          {t("plans")}
        </Link>
        <Link href="/termos" className="underline-offset-4 hover:underline">
          {t("terms")}
        </Link>
        <Link
          href="/privacidade"
          className="underline-offset-4 hover:underline"
        >
          {t("privacy")}
        </Link>
        <Link
          href="/como-usamos-ia"
          className="underline-offset-4 hover:underline"
        >
          {t("aiUsage")}
        </Link>
        <Link href="/riscos" className="underline-offset-4 hover:underline">
          Riscos da automação
        </Link>
      </nav>
    </main>
  )
}
