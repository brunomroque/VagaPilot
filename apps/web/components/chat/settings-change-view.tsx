"use client"

import { useState, useTransition } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"

import {
  cancelChangeAction,
  confirmChangeAction,
  undoChangeAction,
} from "@/app/app/chat/actions"
import type { DiffRow, SettingsChangeOutput } from "@/lib/chat/types"
import { ApprovalCard } from "@workspace/ui/components/approval-card"
import { QuestionCard as QuestionCardClient } from "@workspace/ui/components/question-card"
import { SettingsDiffCard } from "@workspace/ui/components/settings-diff-card"

import { useDiffFormat } from "./use-diff-format"

/** F14 result card: applied changes show the diff with "Desfazer"; sensitive ones ask first. */
export function SettingsChangeView({
  output,
  onQuestion,
}: {
  output: SettingsChangeOutput
  onQuestion?: (option: string) => void
}) {
  const t = useTranslations("Chat.settings")
  const formatRows = useDiffFormat()
  const [current, setCurrent] = useState(output)
  const [busy, startTransition] = useTransition()

  function run(
    action: (input: {
      memoryEventId: string
    }) => Promise<{ ok: true; data: SettingsChangeOutput } | { ok: false }>,
    memoryEventId: string
  ) {
    startTransition(async () => {
      const result = await action({ memoryEventId })
      if (!result.ok) {
        toast.error(t("failed"))
        return
      }
      if (result.data.status === "error") {
        toast.error(result.data.summary)
        return
      }
      setCurrent(result.data)
      toast.success(result.data.summary)
    })
  }

  const title = t(`intents.${intentKey(current.intent)}`)

  switch (current.status) {
    case "applied":
    case "undone":
      return (
        <SettingsDiffCard
          title={title}
          rows={formatRows(current.intent, current.diff as DiffRow[])}
          statusLabel={current.status === "undone" ? t("undone") : t("applied")}
          undone={current.status === "undone"}
          undoLabel={t("undo")}
          onUndo={() => run(undoChangeAction, current.memoryEventId)}
          busy={busy}
          beforeLabel={t("before")}
          afterLabel={t("after")}
        />
      )
    case "pending":
    case "cancelled":
      return (
        <ApprovalCard
          title={title}
          description={
            current.status === "pending" ? t("confirmDescription") : null
          }
          rows={formatRows(current.intent, current.diff as DiffRow[]).map(
            (row) => ({
              label: row.field,
              value: `${row.before} → ${row.after}`,
            })
          )}
          confirmLabel={t("confirm")}
          cancelLabel={t("cancel")}
          onConfirm={() => run(confirmChangeAction, current.memoryEventId)}
          onCancel={() => run(cancelChangeAction, current.memoryEventId)}
          resolved={
            current.status === "cancelled"
              ? { label: t("cancelled"), tone: "muted" }
              : null
          }
          busy={busy}
        />
      )
    case "clarification":
      return (
        <ClarificationView
          question={current.question}
          options={current.options}
          onSelect={onQuestion}
        />
      )
    case "noop":
    case "error":
      return <p className="text-sm text-muted-foreground">{current.summary}</p>
    default: {
      const unreachable: never = current
      throw new Error(`Unknown settings status: ${JSON.stringify(unreachable)}`)
    }
  }
}

const INTENT_KEYS = [
  "create_saved_search",
  "update_saved_search",
  "delete_saved_search",
  "add_excluded_company",
  "remove_excluded_company",
  "update_language_level",
  "set_salary_rules",
  "set_preference",
  "set_approval_mode",
] as const

function intentKey(intent: string): (typeof INTENT_KEYS)[number] | "unknown" {
  return (INTENT_KEYS as readonly string[]).includes(intent)
    ? (intent as (typeof INTENT_KEYS)[number])
    : "unknown"
}

export function ClarificationView({
  question,
  options,
  onSelect,
}: {
  question: string
  options: string[]
  onSelect?: (option: string) => void
}) {
  const t = useTranslations("Chat.settings")
  const [selected, setSelected] = useState<string | null>(null)
  return (
    <QuestionCardClient
      question={question}
      options={options}
      selected={selected}
      optionsLabel={t("options")}
      onSelect={(option) => {
        setSelected(option)
        onSelect?.(option)
      }}
    />
  )
}
