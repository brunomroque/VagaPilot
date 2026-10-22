"use client"

import { useCallback, useEffect, useState, useTransition } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"

import { answerPendingQuestionAction } from "@/app/app/chat/actions"
import { getSupabaseBrowserClient } from "@/lib/supabase/browser"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { QuestionCard } from "@workspace/ui/components/question-card"
import { Textarea } from "@workspace/ui/components/textarea"

export type PendingQuestionView = {
  id: string
  applicationId: string
  questionText: string
  options: string[]
  proposedAnswer: string | null
}

/**
 * Extension fill questions (F8): Realtime on `pending_questions` + text/options answer flow.
 */
export function PendingQuestionsPanel({
  initialQuestions,
}: {
  initialQuestions: PendingQuestionView[]
}) {
  const t = useTranslations("Chat.pendingQuestions")
  const [questions, setQuestions] = useState(initialQuestions)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busy, startTransition] = useTransition()

  const refresh = useCallback(async () => {
    const supabase = getSupabaseBrowserClient()
    if (!supabase) return
    const { data } = await supabase
      .from("pending_questions")
      .select(
        "id, application_id, question_text, options, proposed_answer, status"
      )
      .eq("status", "aberta")
      .order("created_at", { ascending: true })
    setQuestions(
      (data ?? []).map((row) => ({
        id: row.id as string,
        applicationId: row.application_id as string,
        questionText: row.question_text as string,
        options: Array.isArray(row.options) ? (row.options as string[]) : [],
        proposedAnswer: (row.proposed_answer as string | null) ?? null,
      }))
    )
  }, [])

  useEffect(() => {
    if (questions.length === 0) return
    const timer = setInterval(() => {
      void refresh()
    }, 3000)
    return () => clearInterval(timer)
  }, [questions.length, refresh])

  useEffect(() => {
    const supabase = getSupabaseBrowserClient()
    if (!supabase) return
    const channel = supabase
      .channel("pending-questions")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pending_questions" },
        () => {
          void refresh()
        }
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [refresh])

  function submit(questionId: string, answer: string) {
    const trimmed = answer.trim()
    if (!trimmed) return
    startTransition(async () => {
      const result = await answerPendingQuestionAction({
        questionId,
        answer: trimmed,
      })
      if (!result.ok) {
        toast.error(t("failed"))
        return
      }
      setQuestions((current) =>
        current.filter((item) => item.id !== questionId)
      )
      toast.success(t("answered"))
    })
  }

  if (questions.length === 0) return null

  return (
    <section aria-label={t("sectionLabel")} className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-muted-foreground">
        {t("heading")}
      </h3>
      {questions.map((question) => {
        const options =
          question.options.length > 0
            ? question.options
            : question.proposedAnswer
              ? [question.proposedAnswer]
              : []
        if (options.length > 0) {
          return (
            <QuestionCard
              key={question.id}
              question={question.questionText}
              options={options}
              optionsLabel={t("optionsLabel")}
              disabled={busy}
              onSelect={(option) => submit(question.id, option)}
            />
          )
        }
        const draft = drafts[question.id] ?? ""
        return (
          <Card key={question.id} size="sm" className="w-full max-w-2xl">
            <CardHeader>
              <CardTitle className="text-base">
                {question.questionText}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <Textarea
                value={draft}
                onChange={(event) =>
                  setDrafts((current) => ({
                    ...current,
                    [question.id]: event.target.value,
                  }))
                }
                rows={3}
                placeholder={t("placeholder")}
                disabled={busy}
              />
              <Button
                type="button"
                size="sm"
                disabled={busy || !draft.trim()}
                onClick={() => submit(question.id, draft)}
              >
                {t("send")}
              </Button>
            </CardContent>
          </Card>
        )
      })}
    </section>
  )
}
