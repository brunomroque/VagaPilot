"use client"

import { useCallback, useEffect, useRef, useState, useTransition } from "react"
import { AlertCircleIcon, LoaderCircleIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"

import { loadBatchAction, retryWithTextAction } from "@/app/app/chat/actions"
import type { IngestItem, JobCardData } from "@/lib/chat/types"
import { getSupabaseBrowserClient } from "@/lib/supabase/browser"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent } from "@workspace/ui/components/card"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { Textarea } from "@workspace/ui/components/textarea"

import { JobCardView, type CvOption } from "./job-card-view"

const POLL_MS = 1200
const MAX_POLLS = 150

function isRunning(item: IngestItem) {
  return item.status === "pendente" || item.status === "processando"
}

function hostOf(url: string | null) {
  if (!url) return ""
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

/**
 * A batch of links (8.4): each item shows progress, then its JobCard as soon as it is ready
 * (CA6.3 incremental). Realtime on `job_ingestions` triggers a refresh; polling is the fallback.
 */
export function IngestBatch({
  batchId,
  initialItems,
  cvOptions,
}: {
  batchId: string
  initialItems: IngestItem[]
  cvOptions: CvOption[]
}) {
  const t = useTranslations("Jobs.batch")
  const [items, setItems] = useState(initialItems)
  const [cards, setCards] = useState<Record<string, JobCardData>>({})
  const [retries, setRetries] = useState<
    { ingestionId: string; batchId: string; items: IngestItem[] }[]
  >([])
  const polls = useRef(0)

  const refresh = useCallback(async () => {
    const result = await loadBatchAction({ batchId })
    if (!result.ok) return
    const order = new Map(
      initialItems.map((item, index) => [item.ingestionId, index])
    )
    setItems(
      [...result.data.items].sort(
        (a, b) =>
          (order.get(a.ingestionId) ?? Number.MAX_SAFE_INTEGER) -
          (order.get(b.ingestionId) ?? Number.MAX_SAFE_INTEGER)
      )
    )
    setCards((current) => {
      const next = { ...current }
      for (const card of result.data.cards)
        if (!next[card.matchId]) next[card.matchId] = card
      return next
    })
  }, [batchId, initialItems])

  const running =
    items.some(isRunning) ||
    items.some((item) => item.jobMatchId && !cards[item.jobMatchId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => {
      polls.current += 1
      if (polls.current > MAX_POLLS) {
        clearInterval(timer)
        return
      }
      void refresh()
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [running, refresh])

  useEffect(() => {
    const supabase = getSupabaseBrowserClient()
    if (!supabase) return
    const channel = supabase
      .channel(`batch-${batchId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "job_ingestions",
          filter: `batch_id=eq.${batchId}`,
        },
        () => void refresh()
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [batchId, refresh])

  const done = items.filter((item) => !isRunning(item)).length

  return (
    <div
      className="flex w-full flex-col gap-3"
      data-testid="ingest-batch"
      data-batch-id={batchId}
    >
      <p
        className="text-xs text-muted-foreground"
        role="status"
        aria-live="polite"
      >
        {running
          ? t("progress", { done, total: items.length })
          : t("done", { total: items.length })}
      </p>
      {items.map((item) => {
        const card = item.jobMatchId ? cards[item.jobMatchId] : undefined
        if (card)
          return (
            <JobCardView
              key={item.ingestionId}
              initial={card}
              cvOptions={cvOptions}
            />
          )
        if (item.status === "falhou" || item.status === "bloqueada") {
          const retry = retries.find(
            (entry) => entry.ingestionId === item.ingestionId
          )
          return retry ? (
            <IngestBatch
              key={retry.batchId}
              batchId={retry.batchId}
              initialItems={retry.items}
              cvOptions={cvOptions}
            />
          ) : (
            <FailedItem
              key={item.ingestionId}
              item={item}
              onRetried={(next) =>
                setRetries((current) => [
                  ...current,
                  { ingestionId: item.ingestionId, ...next },
                ])
              }
            />
          )
        }
        return (
          <Card
            key={item.ingestionId}
            size="sm"
            className="w-full max-w-2xl"
            aria-busy="true"
            data-testid="job-card-loading"
          >
            <CardContent className="flex flex-col gap-3">
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <LoaderCircleIcon
                  className="size-4 animate-spin"
                  aria-hidden="true"
                />
                {t("analyzing", { host: hostOf(item.url) || t("pastedText") })}
              </p>
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

/** CA4.2: clear message and a field to paste the description. */
function FailedItem({
  item,
  onRetried,
}: {
  item: IngestItem
  onRetried: (next: { batchId: string; items: IngestItem[] }) => void
}) {
  const t = useTranslations("Jobs.batch")
  const [text, setText] = useState("")
  const [pending, startTransition] = useTransition()
  const fieldId = `paste-${item.ingestionId}`
  const reason =
    item.status === "bloqueada"
      ? t("errors.blocked")
      : item.errorCode === "not_found"
        ? t("errors.not_found")
        : item.errorCode === "timeout"
          ? t("errors.timeout")
          : t("errors.generic")

  return (
    <Alert className="w-full max-w-2xl" data-testid="ingest-failed">
      <AlertCircleIcon />
      <AlertTitle>{t("failedTitle", { host: hostOf(item.url) })}</AlertTitle>
      <AlertDescription className="flex w-full flex-col gap-2">
        <p>{reason}</p>
        <form
          className="flex w-full flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            startTransition(async () => {
              const result = await retryWithTextAction({
                ingestionId: item.ingestionId,
                text,
              })
              if (!result.ok) {
                toast.error(t("errors.pasteTooShort"))
                return
              }
              onRetried(result.data)
            })
          }}
        >
          <label
            htmlFor={fieldId}
            className="text-sm font-medium text-foreground"
          >
            {t("pasteLabel")}
          </label>
          <Textarea
            id={fieldId}
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={5}
            maxLength={8000}
            placeholder={t("pastePlaceholder")}
          />
          <div>
            <Button
              type="submit"
              size="sm"
              disabled={pending || text.trim().length < 30}
            >
              {t("pasteSubmit")}
            </Button>
          </div>
        </form>
      </AlertDescription>
    </Alert>
  )
}
