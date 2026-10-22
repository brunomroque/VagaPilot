"use client"

import { CheckCheckIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import { useMemo } from "react"

import { pendingActions } from "@vagapilot/core/tracker"

import { LoadErrorAlert } from "@/components/app/load-error-alert"
import { TaskList } from "@/components/app/task-list"
import { useWorkspace } from "@/components/app/workspace-context"
import { Card, CardContent } from "@workspace/ui/components/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"

/** Actions page: every next_action ordered by next_action_due_at (P3.2, J5). */
export function TasksView() {
  const t = useTranslations("Tasks")
  const { applications, loadError } = useWorkspace()
  const actions = useMemo(() => pendingActions(applications), [applications])

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-bold tracking-tight">{t("title")}</h2>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </div>
      {loadError ? <LoadErrorAlert /> : null}
      <Card>
        <CardContent className="flex flex-col gap-6">
          {actions.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <CheckCheckIcon />
                </EmptyMedia>
                <EmptyTitle>{t("allDone")}</EmptyTitle>
                <EmptyDescription>{t("allDoneDescription")}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <TaskList actions={actions} />
          )}
        </CardContent>
      </Card>
    </section>
  )
}
