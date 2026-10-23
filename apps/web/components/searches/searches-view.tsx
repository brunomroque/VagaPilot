"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { zodResolver } from "@hookform/resolvers/zod"
import {
  PencilIcon,
  PlayIcon,
  PlusIcon,
  TargetIcon,
  Trash2Icon,
} from "lucide-react"
import { useTranslations } from "next-intl"
import { useForm } from "react-hook-form"
import { toast } from "sonner"

import {
  deleteSearchAction,
  previewSearchAction,
  runSearchNowAction,
  saveSearchAction,
  toggleSearchAction,
} from "@/app/app/buscas/actions"
import { FilledViaChatBadgeClient } from "@/components/chat/filled-via-chat-badge-client"
import { IngestBatch } from "@/components/chat/ingest-batch"
import type { CvOption } from "@/components/chat/job-card-view"
import { useDiffFormat } from "@/components/chat/use-diff-format"
import { SelectField, TextField } from "@/components/forms/fields"
import type { IngestItem } from "@/lib/chat/types"
import {
  EMPTY_SEARCH_FORM,
  searchFormSchema,
  searchToForm,
  type SearchFormValues,
} from "@/lib/settings/search-form"
import type { SavedSearch } from "@vagapilot/core/settings"
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
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { FieldGroup } from "@workspace/ui/components/field"
import { Switch } from "@workspace/ui/components/switch"

export type SearchView = SavedSearch & {
  id: string
  active: boolean
  lastRunAt: string | null
  latestBatch: { batchId: string; items: IngestItem[] } | null
}

/** "Buscas salvas" (RF4A.3): list, form with preview, run now and the latest result batch. */
export function SearchesView({
  searches,
  cvOptions,
}: {
  searches: SearchView[]
  cvOptions: CvOption[]
}) {
  const t = useTranslations("Searches")
  const router = useRouter()
  const formatRows = useDiffFormat()
  const [editing, setEditing] = useState<SearchView | "new" | null>(null)
  const [deleting, setDeleting] = useState<SearchView | null>(null)
  const [pending, startTransition] = useTransition()

  function chips(search: SearchView): string[] {
    return formatRows("create_saved_search", [
      { field: "seniority", before: null, after: search.seniority },
      { field: "location", before: null, after: search.location },
      { field: "workModel", before: null, after: search.workModel },
      { field: "regime", before: null, after: search.regime },
      { field: "language", before: null, after: search.language },
      { field: "frequency", before: null, after: search.frequency },
      { field: "timeOfDay", before: null, after: search.timeOfDay },
    ])
      .filter((row) => row.after !== "—")
      .map((row) => row.after)
  }

  function runNow(search: SearchView) {
    startTransition(async () => {
      const result = await runSearchNowAction({ id: search.id })
      if (!result.ok) {
        toast.error(t("errors.run"))
        return
      }
      toast.success(
        result.data.delivered > 0
          ? t("ran", { count: result.data.delivered })
          : t("ranEmpty")
      )
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col">
          <h2 className="text-lg font-bold">{t("title")}</h2>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <Button onClick={() => setEditing("new")}>
          <PlusIcon data-icon="inline-start" />
          {t("new")}
        </Button>
      </div>

      {searches.length === 0 ? (
        <Empty className="border bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <TargetIcon />
            </EmptyMedia>
            <EmptyTitle>
              <h3 className="text-lg font-bold">{t("empty.title")}</h3>
            </EmptyTitle>
            <EmptyDescription>{t("empty.description")}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={() => setEditing("new")}>{t("new")}</Button>
          </EmptyContent>
        </Empty>
      ) : (
        <ul className="flex flex-col gap-4" aria-label={t("listLabel")}>
          {searches.map((search) => (
            <li key={search.id}>
              <Card data-testid="saved-search">
                <CardHeader>
                  <CardTitle className="text-base font-semibold">
                    {search.query}
                  </CardTitle>
                  <CardDescription>
                    {search.lastRunAt
                      ? t("lastRun", {
                          date: new Date(search.lastRunAt).toLocaleString(
                            "pt-BR"
                          ),
                        })
                      : t("neverRun")}
                  </CardDescription>
                  <CardAction>
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Switch
                        checked={search.active}
                        aria-label={t("active", { query: search.query })}
                        onCheckedChange={(active) =>
                          startTransition(async () => {
                            const result = await toggleSearchAction({
                              id: search.id,
                              active,
                            })
                            if (!result.ok) toast.error(t("errors.save"))
                          })
                        }
                      />
                      {search.active ? t("on") : t("off")}
                    </label>
                  </CardAction>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <FilledViaChatBadgeClient
                    tableName="saved_searches"
                    recordId={search.id}
                  />
                  <div className="flex flex-wrap gap-1.5">
                    {chips(search).map((chip) => (
                      <Badge key={chip} variant="secondary">
                        {chip}
                      </Badge>
                    ))}
                    {search.excludedCompanies.map((company) => (
                      <Badge key={company} variant="outline">
                        {t("excludedChip", { company })}
                      </Badge>
                    ))}
                  </div>
                  {search.latestBatch ? (
                    <section
                      aria-label={t("results")}
                      className="flex flex-col gap-2"
                    >
                      <h4 className="text-sm font-semibold">{t("results")}</h4>
                      <IngestBatch
                        batchId={search.latestBatch.batchId}
                        initialItems={search.latestBatch.items}
                        cvOptions={cvOptions}
                      />
                    </section>
                  ) : null}
                </CardContent>
                <CardFooter className="flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => runNow(search)}
                    disabled={pending}
                  >
                    <PlayIcon data-icon="inline-start" />
                    {t("runNow")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setEditing(search)}
                  >
                    <PencilIcon data-icon="inline-start" />
                    {t("edit")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setDeleting(search)}
                  >
                    <Trash2Icon data-icon="inline-start" />
                    {t("delete")}
                  </Button>
                </CardFooter>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {editing ? (
        <SearchFormDialog
          key={editing === "new" ? "new" : editing.id}
          search={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("deleteDescription", { query: deleting?.query ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const target = deleting
                setDeleting(null)
                if (!target) return
                startTransition(async () => {
                  const result = await deleteSearchAction({ id: target.id })
                  if (result.ok) toast.success(result.data.summary)
                  else toast.error(t("errors.save"))
                })
              }}
            >
              {t("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

type PreviewItem = {
  jobMatchId: string
  title: string
  company: string | null
  location: string | null
  fit: string | null
}

function SearchFormDialog({
  search,
  onClose,
}: {
  search: SearchView | null
  onClose: () => void
}) {
  const t = useTranslations("Searches")
  const tSettings = useTranslations("SettingsModel")
  const tCommon = useTranslations("Common")
  const [preview, setPreview] = useState<PreviewItem[] | null>(null)
  const [pending, startTransition] = useTransition()
  const form = useForm<SearchFormValues>({
    resolver: zodResolver(searchFormSchema),
    defaultValues: search ? searchToForm(search) : EMPTY_SEARCH_FORM,
  })

  const any = { value: "", label: t("form.any") }
  const options = (
    group: "seniority" | "workModel" | "regime" | "language" | "timeOfDay",
    values: readonly string[]
  ) => [
    any,
    ...values.map((value) => ({
      value,
      label: tSettings(`values.${group}.${value}` as never),
    })),
  ]

  const onSubmit = form.handleSubmit((values) =>
    startTransition(async () => {
      const result = await saveSearchAction({ id: search?.id ?? null, values })
      if (!result.ok) {
        toast.error(t("errors.save"))
        return
      }
      toast.success(result.data.summary)
      onClose()
    })
  )

  function runPreview() {
    void form.handleSubmit((values) =>
      startTransition(async () => {
        const result = await previewSearchAction(values)
        if (!result.ok) {
          toast.error(t("errors.preview"))
          return
        }
        setPreview(result.data)
      })
    )()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-h-[90svh] overflow-y-auto sm:max-w-2xl"
        closeLabel={tCommon("close")}
      >
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle>{search ? t("editTitle") : t("newTitle")}</DialogTitle>
            <DialogDescription>{t("formDescription")}</DialogDescription>
          </DialogHeader>
          <FieldGroup className="grid gap-4 sm:grid-cols-2">
            <TextField
              control={form.control}
              name="query"
              label={tSettings("fields.query")}
              placeholder={t("form.queryPlaceholder")}
            />
            <TextField
              control={form.control}
              name="location"
              label={tSettings("fields.location")}
              placeholder={t("form.locationPlaceholder")}
            />
            <SelectField
              control={form.control}
              name="seniority"
              label={tSettings("fields.seniority")}
              options={options("seniority", [
                "estagio",
                "junior",
                "pleno",
                "senior",
                "especialista",
                "coordenador",
                "gerente",
                "head",
                "diretor",
                "vp",
                "c_level",
              ])}
            />
            <SelectField
              control={form.control}
              name="workModel"
              label={tSettings("fields.workModel")}
              options={options("workModel", [
                "presencial",
                "hibrido",
                "remoto",
              ])}
            />
            <SelectField
              control={form.control}
              name="regime"
              label={tSettings("fields.regime")}
              options={options("regime", ["clt", "pj", "ambos"])}
            />
            <SelectField
              control={form.control}
              name="language"
              label={tSettings("fields.language")}
              options={options("language", ["pt-BR", "en", "es"])}
            />
            <TextField
              control={form.control}
              name="salaryMin"
              label={tSettings("fields.salaryMin")}
              inputMode="decimal"
            />
            <TextField
              control={form.control}
              name="salaryMax"
              label={tSettings("fields.salaryMax")}
              inputMode="decimal"
            />
            <SelectField
              control={form.control}
              name="postedWithinDays"
              label={tSettings("fields.postedWithinDays")}
              options={[
                any,
                ...["1", "3", "7", "14", "30"].map((days) => ({
                  value: days,
                  label: t("form.days", { count: Number(days) }),
                })),
              ]}
            />
            <TextField
              control={form.control}
              name="excludedCompanies"
              label={tSettings("fields.excludedCompanies")}
              description={t("form.excludedHint")}
            />
            <SelectField
              control={form.control}
              name="frequency"
              label={tSettings("fields.frequency")}
              options={["diaria", "dias_uteis", "semanal"].map((value) => ({
                value,
                label: tSettings(`values.frequency.${value}` as never),
              }))}
            />
            <SelectField
              control={form.control}
              name="timeOfDay"
              label={tSettings("fields.timeOfDay")}
              options={options("timeOfDay", ["manha", "tarde", "noite"])}
            />
          </FieldGroup>
          {preview ? (
            <section
              aria-label={t("preview")}
              className="flex flex-col gap-2 rounded-lg border p-3"
              data-testid="search-preview"
            >
              <h3 className="text-sm font-semibold">{t("preview")}</h3>
              {preview.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("previewEmpty")}
                </p>
              ) : (
                <ul className="flex flex-col gap-1 text-sm">
                  {preview.map((item) => (
                    <li
                      key={item.jobMatchId}
                      className="flex flex-wrap items-center gap-2"
                    >
                      <span className="font-medium">{item.title}</span>
                      <span className="text-muted-foreground">
                        {[item.company, item.location]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                      {item.fit ? (
                        <Badge variant="secondary">
                          {tSettings(`values.fit.${item.fit}` as never)}
                        </Badge>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={runPreview}
              disabled={pending}
            >
              {t("previewAction")}
            </Button>
            <Button type="submit" disabled={pending}>
              {t("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
