"use client"

import * as React from "react"
import { cn } from "cn"
import {
  AlertTriangleIcon,
  BookmarkIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  CircleDashedIcon,
  ExternalLinkIcon,
  FileTextIcon,
  InfoIcon,
  PanelRightOpenIcon,
  SkipForwardIcon,
  WalletIcon,
} from "lucide-react"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@workspace/ui/components/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { Input } from "@workspace/ui/components/input"

export type JobCardFit = "alto" | "medio" | "baixo" | null
export type JobCardDecision = "aplicar" | "pular" | "salvar" | null

export type JobCardLabels = {
  reasons: string
  gaps: string
  noGaps: string
  cv: string
  salary: string
  alerts: string
  actions: string
  apply: string
  skip: string
  save: string
  changeCv: string
  adjustSalary: string
  details: string
  salaryInput: string
  salarySubmit: string
  salaryCancel: string
}

export type JobCardNotice = {
  tone: "info" | "warning" | "success"
  text: string
  action?: { label: string; onClick: () => void }
}

export type JobCardProps = {
  id: string
  company: string
  title: string
  meta: string[]
  fit: JobCardFit
  fitLabel: string | null
  reasons: string[]
  gaps: string[]
  cvLabel: string | null
  salaryLabel: string | null
  alerts: { code: string; text: string }[]
  notice?: JobCardNotice | null
  decision?: JobCardDecision
  status?: React.ReactNode
  busy?: boolean
  labels: JobCardLabels
  cvOptions?: { id: string; label: string }[]
  onApply?: () => void
  onSkip?: () => void
  onSave?: () => void
  onDetails?: () => void
  onChangeCv?: (cvVersionId: string) => void
  onAdjustSalary?: (amount: number) => void
  className?: string
}

const FIT_STYLES: Record<Exclude<JobCardFit, null>, string> = {
  alto: "bg-primary text-primary-foreground",
  medio: "bg-accent text-accent-foreground",
  baixo: "bg-muted text-muted-foreground",
}

const NOTICE_ICONS = {
  info: InfoIcon,
  warning: AlertTriangleIcon,
  success: CheckCircle2Icon,
} as const

/** F7 JobCard: company, role, place/model, fit badge, 3 reasons, gaps, CV, salary, alerts, actions. */
export function JobCard({
  id,
  company,
  title,
  meta,
  fit,
  fitLabel,
  reasons,
  gaps,
  cvLabel,
  salaryLabel,
  alerts,
  notice,
  decision = null,
  status,
  busy = false,
  labels,
  cvOptions = [],
  onApply,
  onSkip,
  onSave,
  onDetails,
  onChangeCv,
  onAdjustSalary,
  className,
}: JobCardProps) {
  const titleId = `${id}-title`
  const [editingSalary, setEditingSalary] = React.useState(false)
  const [salary, setSalary] = React.useState("")
  const NoticeIcon = notice ? NOTICE_ICONS[notice.tone] : null

  function submitSalary(event: React.FormEvent) {
    event.preventDefault()
    const amount = Number(salary.replace(/\./g, "").replace(",", "."))
    if (!Number.isFinite(amount) || amount <= 0) return
    onAdjustSalary?.(amount)
    setEditingSalary(false)
    setSalary("")
  }

  return (
    <Card
      size="sm"
      role="article"
      aria-labelledby={titleId}
      aria-busy={busy || undefined}
      data-testid="job-card"
      data-decision={decision ?? undefined}
      className={cn("w-full max-w-2xl", className)}
    >
      <CardHeader className="grid-cols-[1fr_auto] gap-x-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="truncate text-xs font-medium text-muted-foreground">
            {company}
          </p>
          <h3
            id={titleId}
            className="font-heading text-base leading-snug font-semibold text-balance"
          >
            {title}
          </h3>
          {meta.length > 0 ? (
            <p className="text-xs text-muted-foreground">{meta.join(" · ")}</p>
          ) : null}
        </div>
        {fit && fitLabel ? (
          <Badge
            className={cn("h-6 px-2.5 text-xs font-semibold", FIT_STYLES[fit])}
          >
            {fitLabel}
          </Badge>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {notice && NoticeIcon ? (
          <div
            role={notice.tone === "warning" ? "alert" : "status"}
            className={cn(
              "flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-xs",
              notice.tone === "warning" && "bg-destructive/10 text-destructive",
              notice.tone === "info" &&
                "bg-secondary text-secondary-foreground",
              notice.tone === "success" && "bg-primary/10 text-primary"
            )}
          >
            <NoticeIcon className="size-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1">{notice.text}</span>
            {notice.action ? (
              <Button
                size="xs"
                variant="outline"
                onClick={notice.action.onClick}
                disabled={busy}
              >
                {notice.action.label}
              </Button>
            ) : null}
          </div>
        ) : null}
        {reasons.length > 0 ? (
          <section aria-label={labels.reasons} className="flex flex-col gap-1">
            <h4 className="text-xs font-semibold text-muted-foreground">
              {labels.reasons}
            </h4>
            <ul className="flex flex-col gap-1">
              {reasons.slice(0, 3).map((reason) => (
                <li key={reason} className="flex gap-2 text-sm">
                  <CheckCircle2Icon
                    className="mt-0.5 size-4 shrink-0 text-primary"
                    aria-hidden="true"
                  />
                  <span>{reason}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {gaps.length > 0 || reasons.length > 0 ? (
          <section aria-label={labels.gaps} className="flex flex-col gap-1">
            <h4 className="text-xs font-semibold text-muted-foreground">
              {labels.gaps}
            </h4>
            {gaps.length > 0 ? (
              <ul className="flex flex-col gap-1">
                {gaps.slice(0, 4).map((gap) => (
                  <li key={gap} className="flex gap-2 text-sm">
                    <CircleDashedIcon
                      className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <span>{gap}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{labels.noGaps}</p>
            )}
          </section>
        ) : null}
        {alerts.length > 0 ? (
          <section
            aria-label={labels.alerts}
            className="flex flex-wrap gap-1.5"
          >
            {alerts.map((alert) => (
              <Badge
                key={alert.code}
                variant="destructive"
                className="h-auto py-1 whitespace-normal"
              >
                <AlertTriangleIcon aria-hidden="true" />
                {alert.text}
              </Badge>
            ))}
          </section>
        ) : null}
        {cvLabel || salaryLabel ? (
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            {cvLabel ? (
              <div className="flex items-center gap-2">
                <FileTextIcon
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <dt className="sr-only">{labels.cv}</dt>
                <dd className="min-w-0 truncate">
                  <span className="text-muted-foreground">{labels.cv}: </span>
                  {cvLabel}
                </dd>
              </div>
            ) : null}
            {salaryLabel ? (
              <div className="flex items-center gap-2">
                <WalletIcon
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <dt className="sr-only">{labels.salary}</dt>
                <dd className="min-w-0">
                  <span className="text-muted-foreground">
                    {labels.salary}:{" "}
                  </span>
                  {salaryLabel}
                </dd>
              </div>
            ) : null}
          </dl>
        ) : null}
        {editingSalary ? (
          <form
            onSubmit={submitSalary}
            className="flex flex-wrap items-center gap-2"
          >
            <label htmlFor={`${id}-salary`} className="sr-only">
              {labels.salaryInput}
            </label>
            <Input
              id={`${id}-salary`}
              inputMode="decimal"
              autoFocus
              value={salary}
              onChange={(event) => setSalary(event.target.value)}
              placeholder={labels.salaryInput}
              className="w-40"
            />
            <Button type="submit" size="sm">
              {labels.salarySubmit}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setEditingSalary(false)}
            >
              {labels.salaryCancel}
            </Button>
          </form>
        ) : null}
        {status}
      </CardContent>
      <CardFooter
        className="flex-wrap gap-2"
        role="group"
        aria-label={labels.actions}
      >
        {onApply ? (
          <Button
            size="sm"
            onClick={onApply}
            disabled={busy || decision === "aplicar"}
          >
            <ExternalLinkIcon data-icon="inline-start" />
            {labels.apply}
          </Button>
        ) : null}
        {onSkip ? (
          <Button
            size="sm"
            variant="outline"
            onClick={onSkip}
            disabled={busy || decision === "pular"}
          >
            <SkipForwardIcon data-icon="inline-start" />
            {labels.skip}
          </Button>
        ) : null}
        {onSave ? (
          <Button
            size="sm"
            variant="outline"
            onClick={onSave}
            disabled={busy || decision === "salvar"}
          >
            <BookmarkIcon data-icon="inline-start" />
            {labels.save}
          </Button>
        ) : null}
        {onChangeCv && cvOptions.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button size="sm" variant="ghost" disabled={busy} />}
            >
              {labels.changeCv}
              <ChevronDownIcon data-icon="inline-end" />
            </DropdownMenuTrigger>
            <DropdownMenuContent className="min-w-56">
              <DropdownMenuGroup>
                {cvOptions.map((option) => (
                  <DropdownMenuItem
                    key={option.id}
                    onClick={() => onChangeCv(option.id)}
                  >
                    {option.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {onAdjustSalary ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setEditingSalary(true)}
            disabled={busy}
          >
            {labels.adjustSalary}
          </Button>
        ) : null}
        {onDetails ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={onDetails}
            className="ml-auto"
          >
            <PanelRightOpenIcon data-icon="inline-start" />
            {labels.details}
          </Button>
        ) : null}
      </CardFooter>
    </Card>
  )
}
