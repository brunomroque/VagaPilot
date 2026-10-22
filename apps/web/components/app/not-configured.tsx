import { DatabaseZapIcon } from "lucide-react"
import { getTranslations } from "next-intl/server"

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"

/** Shown when there is no database session (local dev without Supabase). */
export async function NotConfigured({ title }: { title: string }) {
  const t = await getTranslations("Forms")
  return (
    <Empty className="border bg-card">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <DatabaseZapIcon />
        </EmptyMedia>
        <EmptyTitle>
          <h2 className="text-lg font-bold">{title}</h2>
        </EmptyTitle>
        <EmptyDescription>{t("notConfigured")}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}
