"use client"

import Link from "next/link"
import { useState, useTransition } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"

import { decideApprovalAction } from "@/app/app/chat/actions"
import type { ChatToolOutput } from "@/lib/chat/types"
import { ApprovalCard } from "@workspace/ui/components/approval-card"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"

import { ClarificationView } from "./settings-change-view"

export function OptionsView({
  output,
  onSelect,
}: {
  output: Extract<ChatToolOutput, { kind: "options" }>
  onSelect: (text: string) => void
}) {
  return (
    <ClarificationView
      question={output.question}
      options={output.options}
      onSelect={onSelect}
    />
  )
}

export function AtsScoreView({
  output,
  onAction,
}: {
  output: Extract<ChatToolOutput, { kind: "ats_score" }>
  onAction: (text: string) => void
}) {
  const t = useTranslations("Chat.widgets.ats")
  return (
    <Card data-testid="ats-score">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{output.summary}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <p>
          {t("before")}: <strong>{output.before}%</strong>
          {output.after !== null ? (
            <>
              {" "}
              · {t("after")}: <strong>{output.after}%</strong>
            </>
          ) : null}
        </p>
        {output.missing.length > 0 ? (
          <p className="text-muted-foreground">
            {t("missing")}: {output.missing.slice(0, 8).join(", ")}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => onAction(t("generateCv"))}>
            {t("generateCv")}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

export function CvDiffApprovalView({
  output,
}: {
  output: Extract<ChatToolOutput, { kind: "cv_diff" }>
}) {
  const t = useTranslations("Chat.widgets.cvDiff")
  const [busy, startTransition] = useTransition()
  const [resolved, setResolved] = useState<"aprovada" | "rejeitada" | null>(
    null
  )
  function decide(approve: boolean) {
    startTransition(async () => {
      const result = await decideApprovalAction({
        approvalId: output.approvalId,
        approve,
      })
      if (!result.ok) {
        toast.error(t("failed"))
        return
      }
      setResolved(result.data.status)
    })
  }
  return (
    <ApprovalCard
      title={t("title", { track: output.trackLabel })}
      description={output.summary}
      rows={output.additions.map((line, index) => ({
        label: `#${index + 1}`,
        value: line,
      }))}
      confirmLabel={t("approve")}
      cancelLabel={t("reject")}
      onConfirm={() => decide(true)}
      onCancel={() => decide(false)}
      resolved={
        resolved
          ? {
              label: resolved === "aprovada" ? t("approved") : t("rejected"),
              tone: resolved === "aprovada" ? "success" : "muted",
            }
          : null
      }
      busy={busy}
    />
  )
}

export function ApplicationCardView({
  output,
}: {
  output: Extract<ChatToolOutput, { kind: "application_card" }>
}) {
  const t = useTranslations("Chat.widgets.application")
  const href = `/app/candidaturas?id=${output.applicationId}`
  return (
    <Card data-testid="application-card">
      <CardHeader>
        <CardTitle>
          {output.company} · {output.roleTitle}
        </CardTitle>
        <CardDescription>{output.summary}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button render={<Link href={href} />}>{t("open")}</Button>
      </CardContent>
    </Card>
  )
}

export function FactClassificationView({
  output,
  onSelect,
  onDataAction,
}: {
  output: Extract<ChatToolOutput, { kind: "fact_classification" }>
  onSelect: (text: string) => void
  onDataAction?: (data: {
    action: "fact_destination"
    choice: string
    pendingQuestionId: string
    statement: string
    suggestedUsage: "cv_relevant" | "form_only"
  }) => void
}) {
  const t = useTranslations("Chat.widgets.factClass")
  const labels: Record<string, string> = {
    application_only: t("applicationOnly"),
    save_fact: t("saveFact"),
    update_cvs: t("updateCvs"),
    register_gap: t("registerGap"),
  }
  return (
    <Card data-testid="fact-classification-card">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{output.statement}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {output.destinations.map((dest) => (
          <Button
            key={dest}
            size="sm"
            variant="outline"
            data-testid={`fact-dest-${dest}`}
            onClick={() => {
              if (output.pendingQuestionId && onDataAction) {
                onDataAction({
                  action: "fact_destination",
                  choice: dest,
                  pendingQuestionId: output.pendingQuestionId,
                  statement: output.statement,
                  suggestedUsage: output.suggestedUsage,
                })
                return
              }
              onSelect(labels[dest] ?? dest)
            }}
          >
            {labels[dest] ?? dest}
          </Button>
        ))}
      </CardContent>
    </Card>
  )
}

export function ProfileTrackingView({
  output,
}: {
  output: Extract<ChatToolOutput, { kind: "profile_tracking" }>
}) {
  const t = useTranslations("Chat.widgets.profileTracking")
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{output.summary}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        {output.platforms.map((row) => (
          <div key={row.id} className="flex justify-between gap-2">
            <span>{row.platform}</span>
            <span className="text-muted-foreground">
              {row.outdated ? t("outdated") : t("ok")}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
