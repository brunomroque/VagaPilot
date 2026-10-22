"use client"

import { useEffect, useId, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  ArchiveIcon,
  CheckIcon,
  ExternalLinkIcon,
  FileTextIcon,
  SparklesIcon,
} from "lucide-react"
import { useFormatter, useTranslations } from "next-intl"
import { toast } from "sonner"

import {
  allowedTransitions,
  canTransition,
  type ApplicationStatus,
} from "@vagapilot/core/status"
import type { TrackerApplication } from "@vagapilot/core/tracker"

import { CompanyLogo } from "@/components/app/company-logo"
import {
  companyInitials,
  DueBadge,
  StatusBadge,
} from "@/components/app/tracker-ui"
import { useWorkspace } from "@/components/app/workspace-context"
import {
  loadApplicationDetail,
  setNextAction,
  updateNotes,
} from "@/lib/tracker/actions"
import type { ApplicationDetail, TimelineEvent } from "@/lib/tracker/types"
import { Badge } from "@workspace/ui/components/badge"
import { Button, buttonVariants } from "@workspace/ui/components/button"
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import {
  NativeSelect,
  NativeSelectOption,
} from "@workspace/ui/components/native-select"
import { Separator } from "@workspace/ui/components/separator"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@workspace/ui/components/sheet"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { Spinner } from "@workspace/ui/components/spinner"
import { Textarea } from "@workspace/ui/components/textarea"

/** ISO instant → value of <input type="datetime-local"> in the browser's zone. */
function toLocalInput(iso: string | null): string {
  if (!iso) return ""
  const date = new Date(iso)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function fromLocalInput(value: string): string {
  return value ? new Date(value).toISOString() : ""
}

/** Spec 9.3 `evidences.kind`. */
const EVIDENCE_KINDS = [
  "screenshot",
  "protocol_text",
  "email",
  "sent_email",
  "file",
] as const

function isEvidenceKind(kind: string): kind is (typeof EVIDENCE_KINDS)[number] {
  return (EVIDENCE_KINDS as readonly string[]).includes(kind)
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
      {children}
    </h3>
  )
}

function eventTitle(
  event: TimelineEvent,
  t: ReturnType<typeof useTranslations<"Tracker.events">>,
  tStatus: ReturnType<typeof useTranslations<"Status">>
): string {
  switch (event.type) {
    case "status_change": {
      const to = event.toStatus ? tStatus(event.toStatus) : ""
      if (event.imported) return t("imported", { to })
      if (event.created || !event.fromStatus) return t("created", { to })
      return t("statusChange", { from: tStatus(event.fromStatus), to })
    }
    case "deadline_set":
      if (event.done) return t("actionDone", { action: event.action ?? "" })
      return event.action
        ? t("deadlineSet", { action: event.action })
        : t("deadlineCleared")
    case "note":
      return t("note")
    case "question_answered":
      return t("questionAnswered")
    case "email_linked":
      return t("emailLinked")
    case "evidence_added":
      return t("evidenceAdded")
    default: {
      const unreachable: never = event.type
      throw new Error(`Unknown event: ${String(unreachable)}`)
    }
  }
}

function Timeline({ events }: { events: TimelineEvent[] }) {
  const t = useTranslations("Tracker.events")
  const tStatus = useTranslations("Status")
  const tSource = useTranslations("Tracker.eventSources")
  const format = useFormatter()

  if (events.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("empty")}</p>
  }

  return (
    <ol className="flex flex-col gap-4 border-l pl-4" data-testid="timeline">
      {events.map((event) => (
        <li key={event.id} className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold">
            {eventTitle(event, t, tStatus)}
          </span>
          <span className="text-sm text-muted-foreground">
            {[
              tSource(event.source),
              format.dateTime(new Date(event.occurredAt), {
                day: "numeric",
                month: "short",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              }),
              event.confidence !== null
                ? t("confidence", { value: Math.round(event.confidence * 100) })
                : null,
              event.dueAt && !event.done
                ? t("due", {
                    date: format.dateTime(new Date(event.dueAt), {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    }),
                  })
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
          {event.emailSubject || event.hasEvidence ? (
            <span className="text-xs text-muted-foreground">
              {[
                event.emailSubject
                  ? t("email", { subject: event.emailSubject })
                  : null,
                event.hasEvidence ? t("withEvidence") : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          ) : null}
        </li>
      ))}
    </ol>
  )
}

function Evidences({
  detail,
  company,
}: {
  detail: ApplicationDetail
  company: string
}) {
  const t = useTranslations("JobSheet")
  if (detail.evidences.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("noEvidence")}</p>
  }
  return (
    <ul className="flex flex-col gap-3">
      {detail.evidences.map((evidence) => (
        <li
          key={evidence.id}
          className="flex flex-col gap-2 rounded-lg border p-3"
        >
          <span className="flex items-center gap-2 text-sm font-medium">
            <FileTextIcon
              className="size-4 text-muted-foreground"
              aria-hidden="true"
            />
            {isEvidenceKind(evidence.kind)
              ? t(`evidenceKinds.${evidence.kind}`)
              : evidence.kind}
          </span>
          {evidence.imageUrl ? (
            // Signed URL from private storage (5 min); next/image would cache it.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={evidence.imageUrl}
              alt={t("evidenceImage", { company })}
              className="max-h-64 w-full rounded-md border object-contain"
            />
          ) : null}
          {evidence.textExcerpt ? (
            <p className="text-sm whitespace-pre-line text-muted-foreground">
              {evidence.textExcerpt}
            </p>
          ) : null}
          {evidence.url ? (
            <a
              href={evidence.url}
              target="_blank"
              rel="noreferrer noopener"
              className="truncate text-sm text-primary underline-offset-4 hover:underline"
            >
              {evidence.url}
            </a>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

function StatusEditor({ application }: { application: TrackerApplication }) {
  const t = useTranslations("JobSheet")
  const tStatus = useTranslations("Status")
  const { changeStatus } = useWorkspace()
  const id = useId()
  const options = allowedTransitions(application.status, { source: "usuario" })
  const [target, setTarget] = useState<ApplicationStatus | "">("")

  return (
    <Field>
      <FieldLabel htmlFor={id}>{t("changeStatus")}</FieldLabel>
      <div className="flex gap-2">
        <NativeSelect
          id={id}
          className="flex-1"
          value={target}
          disabled={options.length === 0}
          onChange={(event) =>
            setTarget(event.target.value as ApplicationStatus | "")
          }
        >
          <NativeSelectOption value="">
            {options.length === 0 ? t("noTransitions") : t("chooseStatus")}
          </NativeSelectOption>
          {options.map((status) => (
            <NativeSelectOption key={status} value={status}>
              {tStatus(status)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <Button
          variant="outline"
          disabled={target === ""}
          onClick={() => {
            if (target === "") return
            changeStatus(application, target)
            setTarget("")
          }}
        >
          {t("applyStatus")}
        </Button>
      </div>
      <FieldDescription>{t("statusHint")}</FieldDescription>
    </Field>
  )
}

function NextActionEditor({
  application,
}: {
  application: TrackerApplication
}) {
  const t = useTranslations("JobSheet")
  const tTasks = useTranslations("Tasks")
  const { completeAction, now } = useWorkspace()
  const [action, setAction] = useState(application.nextAction ?? "")
  const [due, setDue] = useState(toLocalInput(application.nextActionDueAt))
  const [pending, startTransition] = useTransition()
  const actionId = useId()
  const dueId = useId()

  useEffect(() => {
    setAction(application.nextAction ?? "")
    setDue(toLocalInput(application.nextActionDueAt))
  }, [application.nextAction, application.nextActionDueAt])

  const dirty =
    action.trim() !== (application.nextAction ?? "") ||
    due !== toLocalInput(application.nextActionDueAt)

  return (
    <FieldGroup className="gap-3">
      {application.nextAction ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">
            {application.nextAction}
          </span>
          <DueBadge dueAt={application.nextActionDueAt} now={now} />
        </div>
      ) : null}
      <Field>
        <FieldLabel htmlFor={actionId}>{t("nextActionLabel")}</FieldLabel>
        <Input
          id={actionId}
          value={action}
          maxLength={300}
          placeholder={t("nextActionPlaceholder")}
          onChange={(event) => setAction(event.target.value)}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={dueId}>{t("dueLabel")}</FieldLabel>
        <Input
          id={dueId}
          type="datetime-local"
          value={due}
          onChange={(event) => setDue(event.target.value)}
        />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={!dirty || pending}
          onClick={() =>
            startTransition(async () => {
              const result = await setNextAction({
                id: application.id,
                action,
                dueAt: action.trim() ? fromLocalInput(due) : "",
              })
              if (result.ok) toast.success(t("nextActionSaved"))
              else toast.error(t("saveError"))
            })
          }
        >
          {pending ? <Spinner data-icon="inline-start" /> : null}
          {t("saveNextAction")}
        </Button>
        {application.nextAction ? (
          <Button
            variant="secondary"
            onClick={() => completeAction(application)}
          >
            <CheckIcon data-icon="inline-start" />
            {tTasks("done")}
          </Button>
        ) : null}
      </div>
    </FieldGroup>
  )
}

function NotesEditor({ application }: { application: TrackerApplication }) {
  const t = useTranslations("JobSheet")
  const [notes, setNotes] = useState(application.notes ?? "")
  const [pending, startTransition] = useTransition()
  const id = useId()

  useEffect(() => setNotes(application.notes ?? ""), [application.notes])

  return (
    <Field>
      <FieldLabel htmlFor={id}>{t("notes")}</FieldLabel>
      <Textarea
        id={id}
        value={notes}
        maxLength={5000}
        rows={4}
        onChange={(event) => setNotes(event.target.value)}
      />
      <div>
        <Button
          variant="outline"
          disabled={notes.trim() === (application.notes ?? "") || pending}
          onClick={() =>
            startTransition(async () => {
              const result = await updateNotes({ id: application.id, notes })
              if (result.ok) toast.success(t("notesSaved"))
              else toast.error(t("saveError"))
            })
          }
        >
          {pending ? <Spinner data-icon="inline-start" /> : null}
          {t("saveNotes")}
        </Button>
      </div>
    </Field>
  )
}

function useDetail(application: TrackerApplication | null) {
  const [detail, setDetail] = useState<ApplicationDetail | null>(null)
  const [failed, setFailed] = useState(false)
  const key = application
    ? `${application.id}:${application.updatedAt}:${application.status}:${application.nextAction ?? ""}`
    : null

  useEffect(() => {
    if (!key) return
    const id = key.split(":")[0] ?? ""
    let cancelled = false
    setFailed(false)
    void loadApplicationDetail({ id }).then((result) => {
      if (cancelled) return
      if (result.ok) setDetail(result.data)
      else setFailed(true)
    })
    return () => {
      cancelled = true
    }
  }, [key])

  useEffect(() => {
    if (!application) setDetail(null)
  }, [application])

  return { detail, failed }
}

export function ApplicationSheet() {
  const t = useTranslations()
  const router = useRouter()
  const {
    selectedApplication: application,
    selectApplication,
    changeStatus,
  } = useWorkspace()
  const { detail, failed } = useDetail(application)
  const canArchive =
    application !== null &&
    canTransition(application.status, "descartada", { source: "usuario" })

  return (
    <Sheet
      open={application !== null}
      onOpenChange={(open) => !open && selectApplication(null)}
    >
      <SheetContent
        className="w-full gap-0 sm:max-w-md"
        closeLabel={t("Common.close")}
      >
        {application ? (
          <>
            <SheetHeader className="gap-4 border-b p-6">
              <p className="text-xs font-medium text-muted-foreground">
                {t("JobSheet.title")}
              </p>
              <div className="flex items-center gap-4">
                <CompanyLogo
                  initials={companyInitials(application.company)}
                  size="lg"
                />
                <div className="flex min-w-0 flex-col gap-0.5">
                  <SheetDescription>{application.company}</SheetDescription>
                  <SheetTitle className="text-xl font-bold">
                    {application.roleTitle}
                  </SheetTitle>
                  {application.location ? (
                    <span className="text-sm text-muted-foreground">
                      {application.location}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={application.status} />
                <Badge variant="outline">
                  {t(`Tracker.sources.${application.source}`)}
                </Badge>
                {application.route ? (
                  <Badge variant="outline">
                    {t(`Tracker.routes.${application.route}`)}
                  </Badge>
                ) : null}
                {application.link ? (
                  <a
                    href={application.link}
                    target="_blank"
                    rel="noreferrer noopener"
                    className={buttonVariants({ variant: "link", size: "sm" })}
                  >
                    {t("JobSheet.openLink")}
                    <ExternalLinkIcon data-icon="inline-end" />
                  </a>
                ) : null}
              </div>
            </SheetHeader>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="flex flex-col gap-6 p-6">
                {application.fitScore !== null ? (
                  <Card size="sm">
                    <CardHeader className="grid-cols-[auto_1fr] items-center gap-x-4">
                      <span className="row-span-2 flex size-14 flex-col items-center justify-center rounded-full bg-primary text-primary-foreground">
                        <span className="font-heading text-lg leading-none font-extrabold">
                          {application.fitScore}
                        </span>
                        <span className="text-[0.65rem] uppercase">
                          {t("Board.fit")}
                        </span>
                      </span>
                      <CardTitle>
                        {application.fitScore >= 90
                          ? t("JobSheet.fitExcellent")
                          : application.fitScore >= 75
                            ? t("JobSheet.fitHigh")
                            : t("JobSheet.fitModerate")}
                      </CardTitle>
                      <CardDescription>{t("JobSheet.fitNote")}</CardDescription>
                    </CardHeader>
                  </Card>
                ) : null}
                <section className="flex flex-col gap-3">
                  <SectionTitle>{t("JobSheet.status")}</SectionTitle>
                  <StatusEditor
                    key={application.status}
                    application={application}
                  />
                </section>
                <Separator />
                <section className="flex flex-col gap-3">
                  <SectionTitle>{t("JobSheet.nextAction")}</SectionTitle>
                  <NextActionEditor application={application} />
                </section>
                <Separator />
                <section className="flex flex-col gap-3">
                  <NotesEditor application={application} />
                </section>
                <Separator />
                <section className="flex flex-col gap-3">
                  <SectionTitle>{t("JobSheet.timeline")}</SectionTitle>
                  {failed ? (
                    <p className="text-sm text-destructive">
                      {t("JobSheet.loadError")}
                    </p>
                  ) : detail ? (
                    <Timeline events={detail.events} />
                  ) : (
                    <div className="flex flex-col gap-3">
                      <Skeleton className="h-10 w-full" />
                      <Skeleton className="h-10 w-4/5" />
                    </div>
                  )}
                </section>
                <section className="flex flex-col gap-3">
                  <SectionTitle>{t("JobSheet.evidences")}</SectionTitle>
                  {detail ? (
                    <Evidences detail={detail} company={application.company} />
                  ) : failed ? null : (
                    <Skeleton className="h-16 w-full" />
                  )}
                </section>
              </div>
            </div>
            <Separator />
            <SheetFooter className="flex-row gap-2 p-6">
              {canArchive ? (
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => changeStatus(application, "descartada")}
                >
                  <ArchiveIcon data-icon="inline-start" />
                  {t("JobSheet.archive")}
                </Button>
              ) : null}
              <Button
                className="flex-1"
                onClick={() => {
                  selectApplication(null)
                  router.push("/app/chat")
                }}
              >
                <SparklesIcon data-icon="inline-start" />
                {t("JobSheet.prepare")}
              </Button>
            </SheetFooter>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
