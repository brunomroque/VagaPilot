import Link from "next/link"
import { MailCheckIcon } from "lucide-react"
import { getTranslations } from "next-intl/server"

import { buttonVariants } from "@workspace/ui/components/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"

export default async function VerifyEmailPage() {
  const t = await getTranslations("Auth.verify")

  return (
    <Empty className="border bg-card">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <MailCheckIcon />
        </EmptyMedia>
        <EmptyTitle>
          <h1>{t("title")}</h1>
        </EmptyTitle>
        <EmptyDescription>{t("description")}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Link href="/entrar" className={buttonVariants({ variant: "outline" })}>
          {t("back")}
        </Link>
      </EmptyContent>
    </Empty>
  )
}
