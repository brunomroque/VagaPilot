"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import {
  BriefcaseBusinessIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
  CircleDashedIcon,
  Clock3Icon,
  InboxIcon,
  ListTodoIcon,
  MailIcon,
  TargetIcon,
  WandSparklesIcon,
  type LucideIcon,
} from "lucide-react"
import { useFormatter, useTranslations } from "next-intl"

import {
  filterApplications,
  overviewMetrics,
  pendingActions,
  type PeriodPreset,
  type TrackerFilters,
} from "@vagapilot/core/tracker"

import { ApplicationBoard } from "@/components/app/application-board"
import { LoadErrorAlert } from "@/components/app/load-error-alert"
import { TaskList } from "@/components/app/task-list"
import {
  CombinedFilterMenu,
  PeriodMenu,
} from "@/components/app/tracker-filters"
import { useWorkspace } from "@/components/app/workspace-context"
import { Badge } from "@workspace/ui/components/badge"
import { buttonVariants } from "@workspace/ui/components/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { Progress } from "@workspace/ui/components/progress"

function MetricCard({
  icon: Icon,
  value,
  label,
  aside,
  children,
}: {
  icon: LucideIcon
  value: string
  label: string
  aside?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <Card>
      <CardHeader>
        <span className="flex size-9 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
          <Icon className="size-4" />
        </span>
        {aside ? <CardAction>{aside}</CardAction> : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        <p className="font-heading text-3xl font-extrabold tracking-tight">
          {value}
        </p>
        <CardDescription>{label}</CardDescription>
      </CardContent>
      {children ? (
        <CardFooter className="border-t-0 bg-transparent pt-0">
          {children}
        </CardFooter>
      ) : null}
    </Card>
  )
}

function percent(value: number | null) {
  return value === null ? "—" : `${Math.round(value * 100)}%`
}

function Metrics() {
  const t = useTranslations("Metrics")
  const { applications, now } = useWorkspace()
  const metrics = useMemo(
    () => overviewMetrics(applications, now),
    [applications, now]
  )
  const peak = Math.max(1, ...metrics.weekly)

  return (
    <section
      aria-label={t("label")}
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
    >
      <MetricCard
        icon={BriefcaseBusinessIcon}
        value={String(metrics.thisMonth)}
        label={t("applications")}
        aside={
          <Badge variant="secondary">
            {t("lastMonth", { count: metrics.lastMonth })}
          </Badge>
        }
      >
        <div
          role="img"
          aria-label={t("weekly", { counts: metrics.weekly.join(", ") })}
          className="flex h-8 w-full items-end gap-1"
        >
          {metrics.weekly.map((count, index) => (
            <span
              key={index}
              className="flex-1 rounded-sm bg-chart-1/70"
              style={{ height: `${Math.max(8, (count / peak) * 100)}%` }}
            />
          ))}
        </div>
      </MetricCard>
      <MetricCard
        icon={TargetIcon}
        value={metrics.averageFit === null ? "—" : `${metrics.averageFit}%`}
        label={t("fit")}
        aside={
          <Badge variant="secondary">
            {t("fitSamples", { count: metrics.fitSamples })}
          </Badge>
        }
      >
        <Progress
          value={metrics.averageFit ?? 0}
          className="w-full"
          aria-label={t("fit")}
        />
      </MetricCard>
      <MetricCard
        icon={Clock3Icon}
        value={String(metrics.pending)}
        label={t("pending")}
        aside={
          metrics.overdue + metrics.dueSoon > 0 ? (
            <Badge variant="outline">{t("pendingNote")}</Badge>
          ) : undefined
        }
      >
        {metrics.overdue > 0 ? (
          <Badge variant="destructive">
            {t("overdue", { count: metrics.overdue })}
          </Badge>
        ) : metrics.dueSoon > 0 ? (
          <Badge variant="destructive">
            {t("dueSoon", { count: metrics.dueSoon })}
          </Badge>
        ) : (
          <Badge variant="secondary">{t("nothingUrgent")}</Badge>
        )}
      </MetricCard>
      <MetricCard
        icon={InboxIcon}
        value={percent(metrics.responseRate)}
        label={t("response")}
      >
        <p className="text-xs text-muted-foreground">
          {t("responseNote", { count: metrics.submitted })}
        </p>
      </MetricCard>
    </section>
  )
}

function GmailCard() {
  const t = useTranslations("Rail")
  const format = useFormatter()
  const { gmail, now } = useWorkspace()
  const connected = gmail?.status === "ativo"
  const broken = gmail !== null && !connected
  const reviewCount = gmail?.reviewCount ?? 0

  return (
    <Card size="sm">
      <CardHeader className="grid-cols-[auto_1fr_auto] items-center gap-x-3">
        <span className="row-span-2 flex size-9 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
          <MailIcon className="size-4" />
        </span>
        <CardTitle className="font-semibold">
          {connected
            ? t("gmailTitle")
            : broken
              ? t("gmailErrorTitle")
              : t("gmailOff")}
        </CardTitle>
        {connected ? (
          <CheckCircle2Icon
            className="row-span-2 size-5 text-primary"
            aria-hidden="true"
          />
        ) : (
          <CircleDashedIcon
            className="row-span-2 size-5 text-muted-foreground"
            aria-hidden="true"
          />
        )}
        <CardDescription>
          {broken
            ? t("gmailErrorDescription")
            : !connected
              ? t("gmailOffDescription")
              : gmail?.lastSyncedAt
                ? t("gmailDescription", {
                    time: format.relativeTime(
                      new Date(gmail.lastSyncedAt),
                      now
                    ),
                  })
                : t("gmailNeverSynced")}
        </CardDescription>
      </CardHeader>
      {connected && reviewCount > 0 ? (
        <CardFooter className="border-t-0 bg-transparent">
          <Link
            href="/app/acoes#revise"
            className={buttonVariants({ variant: "secondary", size: "sm" })}
          >
            {t("gmailReview", { count: reviewCount })}
            <ChevronRightIcon data-icon="inline-end" />
          </Link>
        </CardFooter>
      ) : !connected ? (
        <CardFooter className="border-t-0 bg-transparent">
          <Link
            href="/app/configuracoes"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            {t("gmailConnect")}
            <ChevronRightIcon data-icon="inline-end" />
          </Link>
        </CardFooter>
      ) : null}
    </Card>
  )
}

function RightRail() {
  const t = useTranslations("Rail")
  const { applications } = useWorkspace()
  const next = useMemo(
    () => pendingActions(applications).slice(0, 3),
    [applications]
  )

  return (
    <aside className="grid grid-cols-1 content-start gap-4 lg:grid-cols-3 2xl:grid-cols-1">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-bold">
            <ListTodoIcon className="size-4 text-primary" />
            <h3>{t("nextActions")}</h3>
          </CardTitle>
          <CardAction>
            <Link
              href="/app/acoes"
              className={buttonVariants({ variant: "link", size: "sm" })}
            >
              {t("seeAll")}
            </Link>
          </CardAction>
        </CardHeader>
        <CardContent>
          {next.length === 0 ? (
            <Empty className="p-0">
              <EmptyHeader>
                <EmptyTitle>{t("noActions")}</EmptyTitle>
                <EmptyDescription>{t("noActionsDescription")}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <TaskList actions={next} compact />
          )}
        </CardContent>
      </Card>
      <Card className="bg-primary text-primary-foreground ring-0">
        <CardHeader>
          <CardDescription className="flex items-center gap-2 text-primary-foreground/80">
            <WandSparklesIcon className="size-4 text-accent" />
            {t("insightLabel")}
          </CardDescription>
          <CardTitle className="text-lg font-bold">
            <h3>{t("insightTitle")}</h3>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-primary-foreground/85">
            {t.rich("insightBody", {
              strong: (chunks) => (
                <strong className="text-accent">{chunks}</strong>
              ),
            })}
          </p>
        </CardContent>
        <CardFooter className="border-t-0 bg-transparent">
          <Link
            href="/app/buscas"
            className={buttonVariants({ variant: "secondary", size: "sm" })}
          >
            {t("insightAction")}
            <ChevronRightIcon data-icon="inline-end" />
          </Link>
        </CardFooter>
      </Card>
      <GmailCard />
    </aside>
  )
}

const OVERVIEW_DIMENSIONS = ["source", "route", "fit"] as const

export function Overview() {
  const t = useTranslations("Board")
  const { applications, now, loadError } = useWorkspace()
  const [filters, setFilters] = useState<TrackerFilters>({})
  const [period, setPeriod] = useState<PeriodPreset>("tudo")
  const visible = useMemo(
    () => filterApplications(applications, { ...filters, period }, now),
    [applications, filters, period, now]
  )

  return (
    <div className="flex flex-col gap-8">
      {loadError ? <LoadErrorAlert /> : null}
      <Metrics />
      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-bold tracking-tight">{t("title")}</h2>
              <Badge variant="secondary">
                {t("count", {
                  shown: visible.length,
                  total: applications.length,
                })}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">{t("description")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <CombinedFilterMenu
              dimensions={OVERVIEW_DIMENSIONS}
              filters={filters}
              onChange={setFilters}
            />
            <PeriodMenu value={period} onChange={setPeriod} />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-6 2xl:grid-cols-[minmax(0,1fr)_320px]">
          <ApplicationBoard applications={visible} />
          <RightRail />
        </div>
      </section>
    </div>
  )
}
