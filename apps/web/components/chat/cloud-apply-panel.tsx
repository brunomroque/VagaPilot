"use client"

import { useCallback, useEffect, useState, useTransition } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"

import {
  answerPendingQuestionAction,
  cancelApplyRunAction,
  decideFactAction,
  loadApplyRunAction,
  resumeApplyRunAction,
  startCloudApplyAction,
} from "@/app/app/chat/actions"
import { SiteLoginCard } from "@/components/settings/site-login-card"
import type { ApplyRunView } from "@/lib/apply/server"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"

const POLL_MS = 4000
const FINAL = ["submitted", "failed", "cancelled"]
const PHASES = [
  "queued",
  "running",
  "login_required",
  "captcha",
  "waiting_answers",
  "review_ready",
  "submit_approved",
  "submitting",
  "submitted",
  "failed",
  "cancelled",
] as const
const REASONS = ["pool_disabled", "no_url", "unsupported_ats"] as const
type Phase = (typeof PHASES)[number]
type Reason = (typeof REASONS)[number]
const asPhase = (v: string): Phase =>
  (PHASES as readonly string[]).includes(v) ? (v as Phase) : "running"
const asReason = (v: string | null): Reason =>
  (REASONS as readonly string[]).includes(v ?? "")
    ? (v as Reason)
    : "unsupported_ats"

/**
 * "Candidatar na nuvem": starts a cloud-browser run, shows the live view (login, captcha, 2FA),
 * asks unknown questions here and only submits after the user approves the summary.
 */
export function CloudApplyPanel({
  matchId,
  initialRunId,
  available,
  unavailableReason,
}: {
  matchId: string
  initialRunId: string | null
  available: boolean
  unavailableReason: string | null
}) {
  const t = useTranslations("Chat.cloudApply")
  const [runId, setRunId] = useState(initialRunId)
  const [run, setRun] = useState<ApplyRunView | null>(null)
  const [busy, startTransition] = useTransition()
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [remember, setRemember] = useState<Record<string, boolean>>({})

  const refresh = useCallback(async () => {
    if (!runId) return
    const result = await loadApplyRunAction({ runId })
    if (result.ok) setRun(result.data)
  }, [runId])

  useEffect(() => {
    if (!runId) return
    void refresh()
    const id = window.setInterval(() => {
      if (run && FINAL.includes(run.phase)) return
      void refresh()
    }, POLL_MS)
    return () => window.clearInterval(id)
  }, [runId, refresh, run])

  if (!available) {
    return (
      <p className="text-xs text-muted-foreground">
        {t(`unavailable.${asReason(unavailableReason)}`)}
      </p>
    )
  }

  function start() {
    startTransition(async () => {
      const result = await startCloudApplyAction({ matchId })
      if (!result.ok) {
        toast.error(t("errors.start", { reason: result.error.message }))
        return
      }
      setRunId(result.data.runId)
    })
  }

  function answer(questionId: string) {
    const value = answers[questionId]?.trim()
    if (!value) return
    startTransition(async () => {
      const result = await answerPendingQuestionAction({
        questionId,
        answer: value,
        remember: remember[questionId] ?? false,
      })
      if (!result.ok) toast.error(t("errors.generic"))
      await refresh()
    })
  }

  function decide(approve: boolean) {
    if (!run?.approvalId) return
    startTransition(async () => {
      const result = await decideFactAction({
        approvalId: run.approvalId,
        approve,
      })
      if (!result.ok)
        toast.error(t("errors.approval", { reason: result.error.message }))
      await refresh()
    })
  }

  function simple(action: "resume" | "cancel") {
    if (!runId) return
    startTransition(async () => {
      if (action === "resume") await resumeApplyRunAction({ runId })
      else await cancelApplyRunAction({ runId })
      await refresh()
    })
  }

  if (!runId) {
    return (
      <div className="flex flex-col gap-1 rounded-md border p-3 text-sm">
        <p className="text-muted-foreground">{t("intro")}</p>
        <div>
          <Button size="sm" onClick={start} disabled={busy}>
            {t("start")}
          </Button>
        </div>
      </div>
    )
  }

  const phase = run?.phase ?? "queued"
  return (
    <div
      className="flex flex-col gap-3 rounded-md border p-3 text-sm"
      aria-live="polite"
    >
      <div className="flex items-center justify-between gap-2">
        <strong>{t(`phase.${asPhase(phase)}`)}</strong>
        {!FINAL.includes(phase) ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => simple("cancel")}
            disabled={busy}
          >
            {t("cancel")}
          </Button>
        ) : null}
      </div>
      {run?.lastError ? (
        <p className="text-xs text-destructive">{run.lastError}</p>
      ) : null}

      {run?.liveViewUrl ? (
        <div className="flex flex-col gap-2">
          <a
            href={run.liveViewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            {t("openLiveView")}
          </a>
          {phase === "login_required" || phase === "captcha" ? (
            <>
              <p className="text-xs text-muted-foreground">
                {t(phase === "login_required" ? "loginHelp" : "captchaHelp")}
              </p>
              <iframe
                src={run.liveViewUrl}
                title={t("liveViewTitle")}
                className="h-[420px] w-full rounded border"
                sandbox="allow-same-origin allow-scripts allow-forms allow-pointer-lock"
              />
            </>
          ) : null}
        </div>
      ) : null}
      {phase === "login_required" && run ? (
        // Saved login missing/expired: connect the site once, the run resumes by itself.
        <SiteLoginCard
          url={run.targetUrl}
          applyRunId={run.id}
          onDone={() => void refresh()}
        />
      ) : null}
      {(phase === "login_required" || phase === "captcha") &&
      !run?.liveViewUrl ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() => simple("resume")}
          disabled={busy}
        >
          {t("resume")}
        </Button>
      ) : null}

      {phase === "waiting_answers" && run?.questions.length ? (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">{t("questionsHelp")}</p>
          {run.questions.map((q) => (
            <div key={q.id} className="flex flex-col gap-1">
              <label className="font-medium" htmlFor={`q-${q.id}`}>
                {q.question}
              </label>
              {q.options.length ? (
                <div className="flex flex-wrap gap-1">
                  {q.options.map((option) => (
                    <Button
                      key={option}
                      size="sm"
                      variant={answers[q.id] === option ? "default" : "outline"}
                      onClick={() =>
                        setAnswers((a) => ({ ...a, [q.id]: option }))
                      }
                    >
                      {option}
                    </Button>
                  ))}
                </div>
              ) : (
                <Input
                  id={`q-${q.id}`}
                  value={answers[q.id] ?? ""}
                  onChange={(e) =>
                    setAnswers((a) => ({ ...a, [q.id]: e.target.value }))
                  }
                />
              )}
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={remember[q.id] ?? false}
                  onChange={(e) =>
                    setRemember((r) => ({ ...r, [q.id]: e.target.checked }))
                  }
                />
                {t("remember")}
              </label>
              <div>
                <Button
                  size="sm"
                  onClick={() => answer(q.id)}
                  disabled={busy || !answers[q.id]?.trim()}
                >
                  {t("answer")}
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {phase === "review_ready" && run ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">{t("reviewHelp")}</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            {run.reviewFields.map((field, i) => (
              <div key={`${field.label}-${i}`} className="contents">
                <dt className="text-muted-foreground">{field.label}</dt>
                <dd className="break-words">{field.value}</dd>
              </div>
            ))}
          </dl>
          {run.hasScreenshot ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/apply-runs/${run.id}/screenshot?v=${encodeURIComponent(run.updatedAt)}`}
              alt={t("screenshotAlt")}
              className="max-h-96 w-full rounded border object-contain object-top"
            />
          ) : null}
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => decide(true)}
              disabled={busy || !run.approvalId}
            >
              {t("approve")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => decide(false)}
              disabled={busy || !run.approvalId}
            >
              {t("reject")}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
