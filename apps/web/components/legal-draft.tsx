import Link from "next/link"
import { FileTextIcon } from "lucide-react"
import { useTranslations } from "next-intl"

import { Brand } from "@/components/brand"
import { buttonVariants } from "@workspace/ui/components/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"

export function LegalDraft({
  title,
}: {
  title: "termsTitle" | "privacyTitle" | "aiTitle"
}) {
  const t = useTranslations("Legal")

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-8 p-6">
      <Brand />
      <Empty className="max-w-lg border bg-card">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileTextIcon />
          </EmptyMedia>
          <EmptyTitle>
            <h1>{t(title)}</h1>
          </EmptyTitle>
          <EmptyDescription>{t("draft")}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Link href="/" className={buttonVariants({ variant: "outline" })}>
            {t("back")}
          </Link>
        </EmptyContent>
      </Empty>
    </main>
  )
}
