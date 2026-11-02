"use client"

import { useEffect, useState, useTransition } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"

import { answerPendingQuestionAction } from "@/app/app/chat/actions"
import { loadSalaryGateQuestionAction } from "@/lib/apply/salary-gate-actions"
import {
  SALARY_APPLY_BLOCK_REASON,
  SALARY_APPLY_GATE_CANCEL,
  SALARY_APPLY_OVERRIDE_CHOICE,
} from "@vagapilot/core/job-rules"
import { Button } from "@workspace/ui/components/button"

export function SalaryGateActions({
  applicationId,
  nextAction,
}: {
  applicationId: string
  nextAction: string | null
}) {
  const t = useTranslations("JobSheet")
  const [questionId, setQuestionId] = useState<string | null>(null)
  const [busy, startTransition] = useTransition()

  useEffect(() => {
    if (nextAction !== SALARY_APPLY_BLOCK_REASON) {
      setQuestionId(null)
      return
    }
    void loadSalaryGateQuestionAction(applicationId).then((r) => {
      if (r.ok && r.data?.id) setQuestionId(r.data.id)
    })
  }, [applicationId, nextAction])

  if (nextAction !== SALARY_APPLY_BLOCK_REASON || !questionId) return null

  const answer = (choice: string) => {
    startTransition(async () => {
      const result = await answerPendingQuestionAction({
        questionId,
        answer: choice,
      })
      if (result.ok) toast.success(t("salaryGateTitle"))
      else toast.error(t("saveError"))
    })
  }

  return (
    <div className="rounded-md border border-amber-500/50 bg-amber-500/5 p-3 text-sm">
      <p className="font-medium">{t("salaryGateTitle")}</p>
      <p className="mt-1 text-muted-foreground">{t("salaryGateBody")}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={busy}
          onClick={() => answer(SALARY_APPLY_OVERRIDE_CHOICE)}
        >
          {t("salaryGateProceed")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => answer(SALARY_APPLY_GATE_CANCEL)}
        >
          {t("salaryGateCancel")}
        </Button>
      </div>
    </div>
  )
}
