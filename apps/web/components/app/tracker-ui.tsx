"use client"

import { CircleAlertIcon, ClockIcon } from "lucide-react"
import { useFormatter, useTranslations } from "next-intl"

import type { ApplicationStatus } from "@vagapilot/core/status"
import { dueUrgency, type DueUrgency } from "@vagapilot/core/tracker"

import { Badge } from "@workspace/ui/components/badge"

type BadgeVariant = "default" | "secondary" | "outline" | "destructive"

function statusVariant(status: ApplicationStatus): BadgeVariant {
  switch (status) {
    case "entrevista":
    case "proposta":
      return "default"
    case "reprovada":
      return "destructive"
    case "rascunho":
    case "em_andamento":
    case "descartada":
    case "encerrada":
      return "outline"
    case "enviada":
    case "em_analise":
    case "etapa_pendente":
      return "secondary"
    default: {
      const unreachable: never = status
      throw new Error(`Unknown status: ${String(unreachable)}`)
    }
  }
}

export function StatusBadge({ status }: { status: ApplicationStatus }) {
  const t = useTranslations("Status")
  return <Badge variant={statusVariant(status)}>{t(status)}</Badge>
}

export function companyInitials(company: string): string {
  const words = company.trim().split(/\s+/).filter(Boolean)
  const [first, second] = words
  if (!first) return "?"
  if (second) return `${first[0] ?? ""}${second[0] ?? ""}`.toUpperCase()
  return first.slice(0, 2).replace(/^./, (char) => char.toUpperCase())
}

function urgencyVariant(urgency: DueUrgency): BadgeVariant {
  switch (urgency) {
    case "overdue":
    case "soon":
      return "destructive"
    case "scheduled":
      return "secondary"
    case "undated":
      return "outline"
    default: {
      const unreachable: never = urgency
      throw new Error(`Unknown urgency: ${String(unreachable)}`)
    }
  }
}

/** Deadline badge: overdue and due within 48 h stand out; the text always states the date. */
export function DueBadge({ dueAt, now }: { dueAt: string | null; now: Date }) {
  const t = useTranslations("Tasks.due")
  const format = useFormatter()
  const urgency = dueUrgency(dueAt, now)
  const date = dueAt
    ? format.dateTime(new Date(dueAt), {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : ""

  return (
    <Badge variant={urgencyVariant(urgency)} className="shrink-0">
      {urgency === "overdue" ? (
        <CircleAlertIcon data-icon="inline-start" />
      ) : urgency === "undated" ? null : (
        <ClockIcon data-icon="inline-start" />
      )}
      {t(urgency, { date })}
    </Badge>
  )
}
