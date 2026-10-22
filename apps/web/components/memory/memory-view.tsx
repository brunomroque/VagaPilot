"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { BrainIcon, PencilIcon, Undo2Icon, XIcon } from "lucide-react"
import { useFormatter, useTranslations } from "next-intl"
import { toast } from "sonner"

import {
  cancelChangeAction,
  confirmChangeAction,
  undoChangeAction,
} from "@/app/app/chat/actions"
import {
  addExcludedCompanyAction,
  removeExcludedCompanyAction,
  setApprovalModeAction,
  setPreferenceAction,
} from "@/app/app/memoria/actions"
import { useDiffFormat } from "@/components/chat/use-diff-format"
import type { DiffRow } from "@/lib/chat/types"
import { diffValues } from "@vagapilot/core/settings"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog"
import { Badge } from "@workspace/ui/components/badge"
import { Button, buttonVariants } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { Field, FieldLabel } from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import {
  NativeSelect,
  NativeSelectOption,
} from "@workspace/ui/components/native-select"
import { Switch } from "@workspace/ui/components/switch"

export type MemoryEventView = {
  id: string
  intent: string
  origin: "chat" | "formulario" | "automacao"
  utterance: string | null
  target_type: string
  target_id: string | null
  before: unknown
  after: unknown
  status: "aplicada" | "desfeita" | "pendente" | "cancelada"
  created_at: string
}

const EDIT_LINKS: Record<string, string> = {
  create_saved_search: "/app/buscas",
  update_saved_search: "/app/buscas",
  update_language_level: "/app/perfil",
  set_salary_rules: "/app/perfil",
}

type ActionOutcome =
  { ok: true; data: { status: string; summary: string } } | { ok: false }

export function MemoryView({
  events,
  preferences,
  approvalMode,
  excludedCompanies,
}: {
  events: MemoryEventView[]
  preferences: Record<string, unknown>
  approvalMode: "pausar_antes" | "envie_direto"
  excludedCompanies: { id: string; name: string }[]
}) {
  const t = useTranslations("Memory")
  const tChat = useTranslations("Chat.settings")
  const tSettings = useTranslations("SettingsModel")
  const format = useFormatter()
  const router = useRouter()
  const formatRows = useDiffFormat()
  const [pending, startTransition] = useTransition()
  const [company, setCompany] = useState("")
  const [modeDraft, setModeDraft] = useState<
    "pausar_antes" | "envie_direto" | null
  >(null)

  function run(action: () => Promise<ActionOutcome>) {
    startTransition(async () => {
      const result = await action()
      if (!result.ok) {
        toast.error(t("failed"))
        return
      }
      if (result.data.status === "error") toast.error(result.data.summary)
      else toast.success(result.data.summary)
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col">
        <h2 className="text-lg font-bold">{t("title")}</h2>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("preferencesTitle")}</CardTitle>
            <CardDescription>{t("preferencesDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Field orientation="horizontal">
              <Switch
                id="pref-email-salary"
                checked={preferences["email.include_salary"] !== false}
                disabled={pending}
                onCheckedChange={(value) =>
                  run(() =>
                    setPreferenceAction({ key: "email.include_salary", value })
                  )
                }
              />
              <FieldLabel htmlFor="pref-email-salary">
                {tSettings("preferences.email.include_salary")}
              </FieldLabel>
            </Field>
            <Field>
              <FieldLabel htmlFor="pref-min-fit">
                {tSettings("preferences.searches.min_fit")}
              </FieldLabel>
              <NativeSelect
                id="pref-min-fit"
                className="w-full"
                value={String(preferences["searches.min_fit"] ?? "baixo")}
                disabled={pending}
                onChange={(event) =>
                  run(() =>
                    setPreferenceAction({
                      key: "searches.min_fit",
                      value: event.target.value,
                    })
                  )
                }
              >
                {(["baixo", "medio", "alto"] as const).map((level) => (
                  <NativeSelectOption key={level} value={level}>
                    {tSettings(`values.fit.${level}`)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="pref-approval">
                {tSettings("fields.approval_mode")}
              </FieldLabel>
              <NativeSelect
                id="pref-approval"
                className="w-full"
                value={approvalMode}
                disabled={pending}
                onChange={(event) =>
                  setModeDraft(
                    event.target.value === "envie_direto"
                      ? "envie_direto"
                      : "pausar_antes"
                  )
                }
              >
                {(["pausar_antes", "envie_direto"] as const).map((mode) => (
                  <NativeSelectOption key={mode} value={mode}>
                    {tSettings(`values.approvalMode.${mode}`)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("excludedTitle")}</CardTitle>
            <CardDescription>{t("excludedDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                const name = company.trim()
                if (!name) return
                setCompany("")
                run(() => addExcludedCompanyAction({ company: name }))
              }}
            >
              <label htmlFor="excluded-company" className="sr-only">
                {t("excludedAdd")}
              </label>
              <Input
                id="excluded-company"
                value={company}
                onChange={(event) => setCompany(event.target.value)}
                placeholder={t("excludedPlaceholder")}
              />
              <Button type="submit" disabled={pending || !company.trim()}>
                {t("excludedAdd")}
              </Button>
            </form>
            {excludedCompanies.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("excludedEmpty")}
              </p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {excludedCompanies.map((item) => (
                  <li key={item.id}>
                    <Badge variant="secondary" className="h-7 gap-1 pr-1">
                      {item.name}
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label={t("excludedRemove", { company: item.name })}
                        onClick={() =>
                          run(() =>
                            removeExcludedCompanyAction({ company: item.name })
                          )
                        }
                      >
                        <XIcon />
                      </Button>
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <section aria-labelledby="memory-events" className="flex flex-col gap-3">
        <h3 id="memory-events" className="text-base font-semibold">
          {t("eventsTitle")}
        </h3>
        {events.length === 0 ? (
          <Empty className="border bg-card">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <BrainIcon />
              </EmptyMedia>
              <EmptyTitle>
                <span className="text-lg font-bold">{t("emptyTitle")}</span>
              </EmptyTitle>
              <EmptyDescription>{t("emptyDescription")}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ol className="flex flex-col gap-3">
            {events.map((event) => {
              const rows = formatRows(
                event.intent,
                diffValues(event.before, event.after) as DiffRow[]
              ).filter(
                (row) =>
                  ![
                    "id",
                    "created_at",
                    "last_run_at",
                    "normalized_name",
                  ].includes(row.field)
              )
              const edit = EDIT_LINKS[event.intent]
              return (
                <li key={event.id}>
                  <Card
                    size="sm"
                    data-testid="memory-event"
                    data-status={event.status}
                    data-intent={event.intent}
                  >
                    <CardHeader className="grid-cols-[1fr_auto]">
                      <CardTitle>
                        {tChat(`intents.${intentKey(event.intent)}`)}
                      </CardTitle>
                      <Badge
                        variant={
                          event.status === "aplicada" ? "default" : "outline"
                        }
                      >
                        {t(`status.${event.status}`)}
                      </Badge>
                      <CardDescription className="col-span-2">
                        {format.dateTime(new Date(event.created_at), {
                          dateStyle: "short",
                          timeStyle: "short",
                        })}{" "}
                        · {t(`origin.${event.origin}`)}
                        {event.utterance ? ` · “${event.utterance}”` : ""}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-3">
                      {rows.length > 0 ? (
                        <dl className="grid gap-1 text-sm">
                          {rows.map((row) => (
                            <div
                              key={row.field}
                              className="grid grid-cols-[minmax(0,9rem)_1fr] gap-2"
                            >
                              <dt className="text-muted-foreground">
                                {row.field}
                              </dt>
                              <dd className="break-words">
                                <span className="text-muted-foreground line-through">
                                  {row.before}
                                </span>{" "}
                                → {row.after}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      ) : null}
                      <div className="flex flex-wrap gap-2">
                        {event.status === "aplicada" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={pending}
                            onClick={() =>
                              run(() =>
                                undoChangeAction({ memoryEventId: event.id })
                              )
                            }
                          >
                            <Undo2Icon data-icon="inline-start" />
                            {tChat("undo")}
                          </Button>
                        ) : null}
                        {event.status === "pendente" ? (
                          <>
                            <Button
                              size="sm"
                              disabled={pending}
                              onClick={() =>
                                run(() =>
                                  confirmChangeAction({
                                    memoryEventId: event.id,
                                  })
                                )
                              }
                            >
                              {tChat("confirm")}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={pending}
                              onClick={() =>
                                run(() =>
                                  cancelChangeAction({
                                    memoryEventId: event.id,
                                  })
                                )
                              }
                            >
                              {tChat("cancel")}
                            </Button>
                          </>
                        ) : null}
                        {edit && event.status === "aplicada" ? (
                          <Link
                            href={edit}
                            className={buttonVariants({
                              size: "sm",
                              variant: "ghost",
                            })}
                          >
                            <PencilIcon data-icon="inline-start" />
                            {t("edit")}
                          </Link>
                        ) : null}
                      </div>
                    </CardContent>
                  </Card>
                </li>
              )
            })}
          </ol>
        )}
      </section>

      <AlertDialog
        open={modeDraft !== null && modeDraft !== approvalMode}
        onOpenChange={(open) => !open && setModeDraft(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("approvalConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("approvalConfirmDescription", {
                mode: modeDraft
                  ? tSettings(`values.approvalMode.${modeDraft}`)
                  : "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tChat("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const mode = modeDraft
                setModeDraft(null)
                if (mode) run(() => setApprovalModeAction({ mode }))
              }}
            >
              {tChat("confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

const INTENTS = [
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

function intentKey(intent: string): (typeof INTENTS)[number] | "unknown" {
  return (INTENTS as readonly string[]).includes(intent)
    ? (intent as (typeof INTENTS)[number])
    : "unknown"
}
