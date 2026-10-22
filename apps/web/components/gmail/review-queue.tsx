"use client"

import { useMemo, useState, useTransition } from "react"
import { CheckIcon, EyeOffIcon, InboxIcon, PencilIcon } from "lucide-react"
import { useFormatter, useTranslations } from "next-intl"
import { toast } from "sonner"

import {
  allowedTransitions,
  type ApplicationStatus,
} from "@vagapilot/core/status"

import { useWorkspace } from "@/components/app/workspace-context"
import {
  confirmReviewItem,
  correctReviewItem,
  ignoreReviewItem,
} from "@/lib/gmail/actions"
import type { ReviewItem } from "@/lib/gmail/types"
import type { ActionResult } from "@/lib/tracker/types"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Field, FieldGroup, FieldLabel } from "@workspace/ui/components/field"
import {
  NativeSelect,
  NativeSelectOption,
} from "@workspace/ui/components/native-select"
import { Spinner } from "@workspace/ui/components/spinner"

/** "Revise" queue (RF11.3a, CA11.5, J5 step 5): Confirmar / Corrigir / Ignorar in one click. */
export function ReviewQueue({ items }: { items: ReviewItem[] }) {
  const t = useTranslations("Review")
  const [correcting, setCorrecting] = useState<ReviewItem | null>(null)

  if (items.length === 0) return null

  return (
    <section
      id="revise"
      aria-labelledby="revise-title"
      className="flex scroll-mt-28 flex-col gap-4"
    >
      <div className="flex flex-col gap-1">
        <h2
          id="revise-title"
          className="flex items-center gap-2 text-xl font-bold tracking-tight"
        >
          {t("title")}
          <Badge variant="secondary">
            {t("count", { count: items.length })}
          </Badge>
        </h2>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </div>
      <ul className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {items.map((item) => (
          <li key={item.id}>
            <ReviewCard item={item} onCorrect={() => setCorrecting(item)} />
          </li>
        ))}
      </ul>
      <CorrectDialog item={correcting} onClose={() => setCorrecting(null)} />
    </section>
  )
}

function useActionToast() {
  const t = useTranslations("Review")
  return (result: ActionResult<null>, success: string) => {
    if (result.ok) {
      toast.success(success)
      return
    }
    toast.error(
      result.error.code === "invalid_transition"
        ? t("invalidTransition")
        : t("failed")
    )
  }
}

function ReviewCard({
  item,
  onCorrect,
}: {
  item: ReviewItem
  onCorrect: () => void
}) {
  const t = useTranslations("Review")
  const tStatus = useTranslations("Status")
  const format = useFormatter()
  const report = useActionToast()
  const [pending, startTransition] = useTransition()
  const [busy, setBusy] = useState<"confirm" | "ignore" | null>(null)

  const canConfirm =
    item.createdFromEmail || Boolean(item.application && item.suggestedStatus)
  const dateTime = (iso: string) =>
    format.dateTime(new Date(iso), {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })

  function run(kind: "confirm" | "ignore") {
    setBusy(kind)
    startTransition(async () => {
      const result =
        kind === "confirm"
          ? await confirmReviewItem({ id: item.id })
          : await ignoreReviewItem({ id: item.id })
      report(result, kind === "confirm" ? t("confirmed") : t("ignored"))
      setBusy(null)
    })
  }

  return (
    <Card size="sm" className="h-full" data-testid="review-item">
      <CardHeader>
        <CardTitle className="line-clamp-2 font-semibold">
          {item.subject}
        </CardTitle>
        <CardDescription className="truncate">
          {t("from", { from: item.fromAddress ?? "—" })} ·{" "}
          {dateTime(item.receivedAt)}
        </CardDescription>
        <CardAction className="flex flex-col items-end gap-1">
          <Badge variant="outline">{t(`classes.${item.classification}`)}</Badge>
          {item.confidence !== null ? (
            <span className="text-xs text-muted-foreground">
              {t("confidence", { value: Math.round(item.confidence * 100) })}
            </span>
          ) : null}
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {item.snippet ? (
          <p className="line-clamp-3 text-muted-foreground">{item.snippet}</p>
        ) : null}
        <div className="flex flex-col gap-1">
          {item.application ? (
            <p className="font-medium">
              {t("linked", {
                company: item.application.company,
                role: item.application.roleTitle,
              })}
              <span className="font-normal text-muted-foreground">
                {" · "}
                {t("currentStatus", {
                  status: tStatus(item.application.status),
                })}
              </span>
            </p>
          ) : (
            <p className="font-medium">{t("noApplication")}</p>
          )}
          {item.createdFromEmail ? (
            <p className="text-muted-foreground">{t("createdFromEmail")}</p>
          ) : null}
          <p>
            {item.createdFromEmail
              ? t("suggestionKeep")
              : item.suggestedStatus
                ? t("suggestion", { status: tStatus(item.suggestedStatus) })
                : t("suggestionNone")}
          </p>
          {item.reason ? (
            <p className="text-xs text-muted-foreground">
              {t(`reasons.${item.reason}`)}
            </p>
          ) : null}
          {item.deadline ? (
            <p className="text-xs">
              {t("deadline", { date: dateTime(item.deadline) })}
            </p>
          ) : null}
          {item.interviewAt ? (
            <p className="text-xs">
              {t("interview", { date: dateTime(item.interviewAt) })}
            </p>
          ) : null}
        </div>
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={() => run("confirm")}
          disabled={pending || !canConfirm}
        >
          {busy === "confirm" ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <CheckIcon data-icon="inline-start" />
          )}
          {t("confirm")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={onCorrect}
          disabled={pending}
        >
          <PencilIcon data-icon="inline-start" />
          {t("correct")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => run("ignore")}
          disabled={pending}
        >
          {busy === "ignore" ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <EyeOffIcon data-icon="inline-start" />
          )}
          {t("ignore")}
        </Button>
      </CardFooter>
    </Card>
  )
}

function CorrectDialog({
  item,
  onClose,
}: {
  item: ReviewItem | null
  onClose: () => void
}) {
  const t = useTranslations("Review")
  const tStatus = useTranslations("Status")
  const report = useActionToast()
  const { applications } = useWorkspace()
  const [applicationId, setApplicationId] = useState("")
  const [status, setStatus] = useState("")
  const [pending, startTransition] = useTransition()
  const [lastItem, setLastItem] = useState<string | null>(null)

  if (item && item.id !== lastItem) {
    setLastItem(item.id)
    setApplicationId(item.application?.id ?? "")
    setStatus(item.createdFromEmail ? "" : (item.suggestedStatus ?? ""))
  }

  const selected =
    applications.find((application) => application.id === applicationId) ?? null
  const options = useMemo<ApplicationStatus[]>(
    () =>
      selected
        ? allowedTransitions(selected.status, {
            source: "gmail",
            confirmedByUser: true,
          })
        : [],
    [selected]
  )
  const validStatus = options.find((option) => option === status) ?? null

  function save() {
    if (!item || !applicationId) return
    startTransition(async () => {
      const result = await correctReviewItem({
        id: item.id,
        applicationId,
        status: validStatus,
      })
      report(result, t("corrected"))
      if (result.ok) onClose()
    })
  }

  return (
    <Dialog
      open={item !== null}
      onOpenChange={(open) => (open ? null : onClose())}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("correctTitle")}</DialogTitle>
          <DialogDescription>{t("correctDescription")}</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="review-application">
              {t("application")}
            </FieldLabel>
            <NativeSelect
              id="review-application"
              value={applicationId}
              onChange={(event) => {
                setApplicationId(event.target.value)
                setStatus("")
              }}
            >
              <NativeSelectOption value="">
                {t("chooseApplication")}
              </NativeSelectOption>
              {applications.map((application) => (
                <NativeSelectOption key={application.id} value={application.id}>
                  {application.company} · {application.roleTitle} (
                  {tStatus(application.status)})
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field data-disabled={!selected || undefined}>
            <FieldLabel htmlFor="review-status">{t("status")}</FieldLabel>
            <NativeSelect
              id="review-status"
              value={validStatus ?? ""}
              disabled={!selected}
              onChange={(event) => setStatus(event.target.value)}
            >
              <NativeSelectOption value="">
                {t("keepStatus")}
              </NativeSelectOption>
              {options.map((option) => (
                <NativeSelectOption key={option} value={option}>
                  {tStatus(option)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button onClick={save} disabled={!applicationId || pending}>
            {pending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <InboxIcon data-icon="inline-start" />
            )}
            {t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
