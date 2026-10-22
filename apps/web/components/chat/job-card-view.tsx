"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { ExternalLinkIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"

import {
  adjustSalaryAction,
  analyzeAnywayAction,
  changeCvAction,
  decideJobAction,
} from "@/app/app/chat/actions"
import type { JobCardData, JobDecision } from "@/lib/chat/types"
import { Badge } from "@workspace/ui/components/badge"
import { buttonVariants } from "@workspace/ui/components/button"
import { JobCard, type JobCardNotice } from "@workspace/ui/components/job-card"
import { Separator } from "@workspace/ui/components/separator"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@workspace/ui/components/sheet"
import { StatusChangeCard } from "@workspace/ui/components/status-change-card"

import { useJobFormat } from "./use-job-format"

export type CvOption = { id: string; label: string }

/** JobCard bound to the widget server actions (never the LLM, CA7.1) plus the detail sheet. */
export function JobCardView({
  initial,
  cvOptions,
}: {
  initial: JobCardData
  cvOptions: CvOption[]
}) {
  const router = useRouter()
  const tCommon = useTranslations("Common")
  const f = useJobFormat()
  const [card, setCard] = useState(initial)
  const [busy, startTransition] = useTransition()
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [statusChange, setStatusChange] = useState<{
    from: string | null
    to: string
  } | null>(null)

  function decide(decision: JobDecision) {
    if (decision === "aplicar") {
      const target = card.applyUrl ?? card.canonicalUrl
      if (/^https?:\/\//.test(target))
        window.open(target, "_blank", "noopener,noreferrer")
    }
    startTransition(async () => {
      const result = await decideJobAction({ matchId: card.matchId, decision })
      if (!result.ok) {
        toast.error(f.t("errors.decision"))
        return
      }
      setCard((current) => ({
        ...current,
        decision,
        application: { id: result.data.applicationId, status: result.data.to },
      }))
      setStatusChange({ from: result.data.from, to: result.data.to })
      toast.success(f.t(`decided.${decision}`))
    })
  }

  function replaceWith(
    action: () => Promise<
      { ok: true; data: JobCardData | null } | { ok: false }
    >,
    error: string
  ) {
    startTransition(async () => {
      const result = await action()
      if (!result.ok || !result.data) {
        toast.error(error)
        return
      }
      setCard(result.data)
    })
  }

  let notice: JobCardNotice | null = null
  if (card.blocked) {
    notice = {
      tone: "warning",
      text: f.t("blocked"),
      action: {
        label: f.t("analyzeAnyway"),
        onClick: () =>
          replaceWith(
            () => analyzeAnywayAction({ matchId: card.matchId }),
            f.t("errors.generic")
          ),
      },
    }
  } else if (card.duplicate?.status === "ja_aplicado") {
    notice = {
      tone: "warning",
      text: f.t("duplicate.ja_aplicado", {
        date: f.date(card.duplicate.appliedAt),
      }),
      action: {
        label: f.t("openTracker"),
        onClick: () => router.push("/app/candidaturas"),
      },
    }
  } else if (card.duplicate?.status === "possivel_duplicata") {
    notice = { tone: "info", text: f.t("duplicate.possivel_duplicata") }
  } else if (
    card.duplicate?.status === "nao_aplicado" &&
    (card.duplicate.gmail?.matchCount ?? 0) > 0
  ) {
    notice = { tone: "info", text: f.t("duplicate.gmail_hint") }
  }

  const decided = card.decision
  const showStatus =
    statusChange ??
    (card.application ? { from: null, to: card.application.status } : null)

  return (
    <>
      <JobCard
        id={`job-${card.matchId}`}
        company={card.company ?? f.t("unknownCompany")}
        title={card.title}
        meta={f.meta(card)}
        fit={card.blocked ? null : card.fit}
        fitLabel={card.blocked ? null : f.fitLabel(card)}
        reasons={card.blocked ? [] : card.reasons.map((reason) => reason.text)}
        gaps={
          card.blocked
            ? []
            : card.gaps.map((gap) =>
                gap.severity === "desejavel"
                  ? f.t("gapPreferred", { requirement: gap.requirement })
                  : gap.requirement
              )
        }
        cvLabel={card.blocked ? null : (card.cv?.label ?? null)}
        salaryLabel={card.blocked ? null : f.salaryLabel(card)}
        alerts={card.alerts.map((alert) => ({
          code: alert.code,
          text: f.alertText(alert),
        }))}
        notice={notice}
        decision={decided}
        busy={busy}
        cvOptions={cvOptions}
        labels={{
          reasons: f.t("labels.reasons"),
          gaps: f.t("labels.gaps"),
          noGaps: f.t("labels.noGaps"),
          cv: f.t("labels.cv"),
          salary: f.t("labels.salary"),
          alerts: f.t("labels.alerts"),
          actions: f.t("labels.actions", { title: card.title }),
          apply: f.t("actions.apply"),
          skip: f.t("actions.skip"),
          save: f.t("actions.save"),
          changeCv: f.t("actions.changeCv"),
          adjustSalary: f.t("actions.adjustSalary"),
          details: f.t("actions.details"),
          salaryInput: f.t("actions.salaryInput"),
          salarySubmit: f.t("actions.salarySubmit"),
          salaryCancel: f.t("actions.salaryCancel"),
        }}
        status={
          showStatus ? (
            <StatusChangeCard
              title={`${card.company ?? ""} · ${card.title}`}
              from={showStatus.from ? f.statusLabel(showStatus.from) : null}
              to={f.statusLabel(showStatus.to)}
              action={{
                label: f.t("openTracker"),
                onClick: () => router.push("/app/candidaturas"),
              }}
            />
          ) : null
        }
        onApply={card.blocked ? undefined : () => decide("aplicar")}
        onSkip={() => decide("pular")}
        onSave={card.blocked ? undefined : () => decide("salvar")}
        onDetails={() => setDetailsOpen(true)}
        onChangeCv={(cvVersionId) =>
          replaceWith(
            () => changeCvAction({ matchId: card.matchId, cvVersionId }),
            f.t("errors.generic")
          )
        }
        onAdjustSalary={(amount) =>
          replaceWith(
            () => adjustSalaryAction({ matchId: card.matchId, amount }),
            f.t("errors.generic")
          )
        }
      />
      <Sheet open={detailsOpen} onOpenChange={setDetailsOpen}>
        <SheetContent
          className="w-full overflow-y-auto sm:max-w-lg"
          closeLabel={tCommon("close")}
        >
          <SheetHeader>
            <SheetTitle>{card.title}</SheetTitle>
            <SheetDescription>
              {[card.company, ...f.meta(card)].filter(Boolean).join(" · ")}
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-4 px-4 pb-6 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              {card.fit ? <Badge>{f.fitLabel(card)}</Badge> : null}
              <Badge variant="outline">{f.sourceLabel(card.source)}</Badge>
              <a
                href={card.applyUrl ?? card.canonicalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                <ExternalLinkIcon data-icon="inline-start" />
                {f.t("detail.openPosting")}
              </a>
            </div>
            <DetailList
              title={f.t("detail.required")}
              items={card.requirementsRequired}
              empty={f.t("detail.none")}
            />
            <DetailList
              title={f.t("detail.preferred")}
              items={card.requirementsPreferred}
              empty={f.t("detail.none")}
            />
            <DetailList
              title={f.t("labels.reasons")}
              items={card.reasons.map((reason) => reason.text)}
              empty={f.t("detail.none")}
            />
            <DetailList
              title={f.t("labels.gaps")}
              items={card.gaps.map(
                (gap) =>
                  `${gap.requirement} (${f.t(`severity.${gap.severity}`)})`
              )}
              empty={f.t("labels.noGaps")}
            />
            {card.applyEmail ? (
              <p>
                <span className="text-muted-foreground">
                  {f.t("detail.applyEmail")}:{" "}
                </span>
                {card.applyEmail}
              </p>
            ) : null}
            <Separator />
            <section className="flex flex-col gap-1">
              <h3 className="font-semibold">{f.t("detail.description")}</h3>
              <p className="whitespace-pre-wrap text-muted-foreground">
                {card.description ?? f.t("detail.none")}
              </p>
            </section>
            <p className="text-xs text-muted-foreground">
              {f.t("detail.versions", {
                model: card.modelVersion ?? "—",
                prompt: card.promptVersion ?? "—",
              })}
            </p>
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}

function DetailList({
  title,
  items,
  empty,
}: {
  title: string
  items: string[]
  empty: string
}) {
  return (
    <section className="flex flex-col gap-1">
      <h3 className="font-semibold">{title}</h3>
      {items.length > 0 ? (
        <ul className="list-disc pl-5">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">{empty}</p>
      )}
    </section>
  )
}
