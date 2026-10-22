"use client"

import { CheckIcon } from "lucide-react"
import { useTranslations } from "next-intl"

import type { PendingAction } from "@vagapilot/core/tracker"

import { DueBadge } from "@/components/app/tracker-ui"
import { useWorkspace } from "@/components/app/workspace-context"
import { Button } from "@workspace/ui/components/button"

/** "Suas ações" rows: open the application, see the deadline, mark as done (P3.2). */
export function TaskList({
  actions,
  compact = false,
}: {
  actions: PendingAction[]
  compact?: boolean
}) {
  const t = useTranslations("Tasks")
  const { applications, completeAction, selectApplication, now } =
    useWorkspace()

  return (
    <ul className="flex flex-col divide-y" aria-label={t("listLabel")}>
      {actions.map((action) => {
        const application = applications.find(
          (item) => item.id === action.applicationId
        )
        return (
          <li
            key={action.applicationId}
            data-testid={`action-${action.applicationId}`}
            className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3 first:pt-0 last:pb-0"
          >
            <button
              type="button"
              onClick={() => selectApplication(action.applicationId)}
              className="flex min-w-0 flex-1 basis-56 flex-col rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="line-clamp-2 text-sm font-semibold">
                {action.action}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {compact
                  ? action.company
                  : `${action.company} · ${action.roleTitle}`}
              </span>
            </button>
            <DueBadge dueAt={action.dueAt} now={now} />
            {application ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => completeAction(application)}
                aria-label={t("doneLabel", {
                  title: action.action,
                  company: action.company,
                })}
              >
                <CheckIcon data-icon="inline-start" />
                {t("done")}
              </Button>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}
