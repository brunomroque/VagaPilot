"use client"

import Link from "next/link"
import { ChevronRightIcon, LayoutDashboardIcon } from "lucide-react"
import { useFormatter, useTranslations } from "next-intl"
import { useMemo } from "react"

import { overviewMetrics } from "@vagapilot/core/tracker"

import { useWorkspace } from "@/components/app/workspace-context"
import { buttonVariants } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"

/** Sidebar summary on the chat-first home (spec 3.1). */
export function OverviewCompact() {
  const t = useTranslations("AppHome.panel")
  const format = useFormatter()
  const { applications, now, openTaskCount } = useWorkspace()
  const metrics = useMemo(
    () => overviewMetrics(applications, now),
    [applications, now]
  )

  return (
    <Card className="h-fit">
      <CardHeader className="flex-row items-start justify-between gap-2">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <LayoutDashboardIcon className="size-4" aria-hidden="true" />
            {t("title")}
          </CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </div>
        <Link
          href="/app/visao-geral"
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          {t("full")}
          <ChevronRightIcon data-icon="inline-end" className="size-4" />
        </Link>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground">
            {t("applicationsMonth")}
          </span>
          <span className="font-semibold tabular-nums">
            {format.number(metrics.thisMonth)}
          </span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground">{t("pendingActions")}</span>
          <span className="font-semibold tabular-nums">{openTaskCount}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground">{t("avgFit")}</span>
          <span className="font-semibold tabular-nums">
            {metrics.averageFit !== null
              ? `${Math.round(metrics.averageFit)}%`
              : "—"}
          </span>
        </div>
      </CardContent>
    </Card>
  )
}
