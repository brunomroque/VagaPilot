import Link from "next/link"
import type { LucideIcon } from "lucide-react"
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

type Section = "chat" | "searches" | "profile" | "settings"

export async function PagePlaceholder({
  section,
  icon: Icon,
}: {
  section: Section
  icon: LucideIcon
}) {
  const t = await getTranslations("Placeholder")

  return (
    <Empty className="border bg-card">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon />
        </EmptyMedia>
        <EmptyTitle>
          <h2 className="text-lg font-bold">{t(`${section}.title`)}</h2>
        </EmptyTitle>
        <EmptyDescription>{t(`${section}.description`)}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Link href="/app" className={buttonVariants({ variant: "outline" })}>
          {t("backToOverview")}
        </Link>
      </EmptyContent>
    </Empty>
  )
}
