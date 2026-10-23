"use client"

import { useState, useTransition } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"

import { decideFactAction } from "@/app/app/chat/actions"
import type { ChatToolOutput } from "@/lib/chat/types"
import { ActionList } from "@workspace/ui/components/action-list"
import { ApprovalCard } from "@workspace/ui/components/approval-card"
import { StatusChangeCard } from "@workspace/ui/components/status-change-card"

import { IngestBatch } from "./ingest-batch"
import { JobCardsById } from "./job-cards-by-id"
import type { CvOption } from "./job-card-view"
import {
  ApplicationCardView,
  AttachmentIntentView,
  AtsScoreView,
  CvDiffApprovalView,
  CvReviewView,
  FactClassificationView,
  FileUploadView,
  OptionsView,
  ProfileTrackingView,
} from "./chat-widgets-extra"
import { CloudApplyPanel } from "./cloud-apply-panel"
import { DeepLinkView } from "./deep-link-view"
import { ClarificationView, SettingsChangeView } from "./settings-change-view"
import { useJobFormat } from "./use-job-format"

/** Picks the widget for a tool result (F7 RF7.1). Buttons inside call server actions only. */
export function ToolOutputView({
  output,
  cvOptions,
  onAnswer,
  onDataAction,
}: {
  output: ChatToolOutput
  cvOptions: CvOption[]
  onAnswer: (text: string) => void
  onDataAction?: (data: {
    action: "fact_destination" | "attachment_intent"
    choice: string
    pendingQuestionId?: string
    statement?: string
    suggestedUsage?: "cv_relevant" | "form_only"
    attachmentIds?: string[]
  }) => void
}) {
  const f = useJobFormat()
  const t = useTranslations("Chat.widgets")
  switch (output.kind) {
    case "ingest_batch":
      return (
        <IngestBatch
          batchId={output.batchId}
          initialItems={output.items}
          cvOptions={cvOptions}
        />
      )
    case "job_card":
      return (
        <JobCardsById matchIds={[output.jobMatchId]} cvOptions={cvOptions} />
      )
    case "status_change":
      return (
        <StatusChangeCard
          title={`${output.company} · ${output.roleTitle}`}
          from={output.from ? f.statusLabel(output.from) : null}
          to={f.statusLabel(output.to)}
        />
      )
    case "action_list":
      return (
        <ActionList
          title={t("pendingTitle")}
          emptyLabel={t("pendingEmpty")}
          summary={
            <p className="text-sm text-muted-foreground">
              {t("pendingCounts", output.counts)}
            </p>
          }
          items={output.actions.map((action) => {
            const due = action.dueAt ? new Date(action.dueAt) : null
            const overdue = due ? due.getTime() < Date.now() : false
            const soon = due
              ? due.getTime() - Date.now() < 48 * 60 * 60 * 1000
              : false
            return {
              id: action.applicationId,
              title: action.action,
              subtitle: `${action.company} · ${action.roleTitle}`,
              due: due ? f.date(action.dueAt) : null,
              tone: overdue ? "overdue" : soon ? "soon" : "normal",
              href: "/app/acoes",
            }
          })}
        />
      )
    case "clarification":
    case "options":
      return output.kind === "options" ? (
        <OptionsView output={output} onSelect={onAnswer} />
      ) : (
        <ClarificationView
          question={output.question}
          options={output.options}
          onSelect={onAnswer}
        />
      )
    case "deep_link":
      return <DeepLinkView output={output} />
    case "ats_score":
      return <AtsScoreView output={output} onAction={onAnswer} />
    case "cv_diff":
      return <CvDiffApprovalView output={output} />
    case "application_card":
      return <ApplicationCardView output={output} />
    case "fact_classification":
      return (
        <FactClassificationView
          output={output}
          onSelect={onAnswer}
          onDataAction={onDataAction}
        />
      )
    case "profile_tracking":
      return <ProfileTrackingView output={output} />
    case "apply_run":
      return (
        <CloudApplyPanel
          matchId={output.jobMatchId}
          initialRunId={output.runId}
          available={output.available}
          unavailableReason={output.unavailableReason}
        />
      )
    case "next_steps":
      return null
    case "fact_approval":
      return <FactApproval output={output} />
    case "settings_change":
      return <SettingsChangeView output={output} onQuestion={onAnswer} />
    case "email_draft":
    case "email_approval":
    case "email_sent":
    case "export_link":
    case "duplicate":
    case "facts":
    case "profile":
    case "cv":
    case "salary":
    case "settings":
    case "error":
      return null
    case "file_upload":
      return <FileUploadView output={output} />
    case "attachment_progress":
      return (
        <p
          className="text-sm text-muted-foreground"
          data-testid="attachment-progress"
        >
          {output.summary}
        </p>
      )
    case "cv_review":
      return <CvReviewView output={output} />
    case "attachment_intent":
      return (
        <AttachmentIntentView
          output={output}
          onSelect={(data) => onDataAction?.(data)}
        />
      )
    default: {
      const unreachable: never = output
      throw new Error(`Unknown tool output: ${JSON.stringify(unreachable)}`)
    }
  }
}

function FactApproval({
  output,
}: {
  output: Extract<ChatToolOutput, { kind: "fact_approval" }>
}) {
  const t = useTranslations("Chat.widgets")
  const [resolved, setResolved] = useState<"aprovada" | "rejeitada" | null>(
    null
  )
  const [busy, startTransition] = useTransition()
  function decide(approve: boolean) {
    startTransition(async () => {
      const result = await decideFactAction({
        approvalId: output.approvalId,
        approve,
      })
      if (!result.ok) {
        toast.error(t("factFailed"))
        return
      }
      setResolved(result.data.status)
    })
  }
  return (
    <ApprovalCard
      title={t("factTitle")}
      description={t("factDescription")}
      rows={[{ label: t("factLabel"), value: output.statement }]}
      confirmLabel={t("factConfirm")}
      cancelLabel={t("factReject")}
      onConfirm={() => decide(true)}
      onCancel={() => decide(false)}
      resolved={
        resolved
          ? {
              label:
                resolved === "aprovada"
                  ? t("factConfirmed")
                  : t("factRejected"),
              tone: resolved === "aprovada" ? "success" : "muted",
            }
          : null
      }
      busy={busy}
    />
  )
}
