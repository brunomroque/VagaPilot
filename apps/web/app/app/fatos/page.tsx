import Link from "next/link"
import { FileUpIcon, ListChecksIcon } from "lucide-react"
import { getTranslations } from "next-intl/server"

import { NotConfigured } from "@/components/app/not-configured"
import { FactReview } from "@/components/facts/fact-review"
import { FactStatusTabs } from "@/components/facts/fact-status-tabs"
import { loadFactReview } from "@/lib/facts/server"
import { PendingStartDates } from "@/components/profile/pending-start-dates"
import { getUserContext } from "@/lib/server/context"
import { FACT_STATUSES, type FactStatus } from "@vagapilot/core/facts"
import { buttonVariants } from "@workspace/ui/components/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"

export default async function FactsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const t = await getTranslations("Facts")
  const context = await getUserContext()
  if (!context.ok) return <NotConfigured title={t("title")} />

  const requested = (await searchParams).status
  const status: FactStatus =
    FACT_STATUSES.find((value) => value === requested) ?? "proposto"
  const review = await loadFactReview(context.ctx, status)

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-bold tracking-tight">{t("title")}</h2>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </div>
      <PendingStartDates ctx={context.ctx} />
      <FactStatusTabs
        basePath="/app/fatos"
        current={status}
        counts={review.counts}
      />
      {review.groups.length === 0 ? (
        <Empty className="border bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ListChecksIcon />
            </EmptyMedia>
            <EmptyTitle>{t(`empty.${status}.title`)}</EmptyTitle>
            <EmptyDescription>
              {t(`empty.${status}.description`)}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Link
              href="/app/cvs"
              className={buttonVariants({ variant: "outline" })}
            >
              <FileUpIcon data-icon="inline-start" />
              {t("goToCvs")}
            </Link>
          </EmptyContent>
        </Empty>
      ) : (
        <FactReview groups={review.groups} status={status} />
      )}
    </section>
  )
}
