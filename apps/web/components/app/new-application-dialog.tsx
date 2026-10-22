"use client"

import { useEffect, useTransition } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { PlusIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import {
  Controller,
  useForm,
  type FieldError as FormFieldError,
} from "react-hook-form"
import { toast } from "sonner"
import type { z } from "zod"

import { APPLICATION_STATUSES } from "@vagapilot/core/status"
import { APPLICATION_ROUTES, JOB_SOURCES } from "@vagapilot/core/tracker"

import { useWorkspace } from "@/components/app/workspace-context"
import { createApplication } from "@/lib/tracker/actions"
import { createApplicationSchema } from "@/lib/tracker/schemas"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import {
  NativeSelect,
  NativeSelectOption,
} from "@workspace/ui/components/native-select"
import { Spinner } from "@workspace/ui/components/spinner"
import { Textarea } from "@workspace/ui/components/textarea"

type FormInput = z.input<typeof createApplicationSchema>
type FormOutput = z.output<typeof createApplicationSchema>

const ERROR_KEYS = ["required", "tooLong", "invalidUrl", "invalidDate"] as const

function todayInput(): string {
  const now = new Date()
  const offset = now.getTimezoneOffset() * 60_000
  return new Date(now.getTime() - offset).toISOString().slice(0, 10)
}

/** <input type="date"> → ISO at local noon, so the day never shifts across zones. */
function dateInputToIso(value: string): string {
  return value ? new Date(`${value}T12:00`).toISOString() : ""
}

function dateTimeInputToIso(value: string): string {
  return value ? new Date(value).toISOString() : ""
}

function emptyValues(link = ""): FormInput {
  return {
    company: "",
    roleTitle: "",
    link,
    source: "outro",
    route: "manual",
    status: "enviada",
    appliedAt: todayInput(),
    cvVersionId: "",
    salaryInformed: "",
    nextAction: "",
    nextActionDueAt: "",
    notes: "",
  }
}

/** Manual creation of an application (P3.1), Field + Zod. */
export function NewApplicationDialog() {
  const t = useTranslations("Tracker.form")
  const tTracker = useTranslations("Tracker")
  const tStatus = useTranslations("Status")
  const tCommon = useTranslations("Common")
  const {
    createOpen,
    setCreateOpen,
    createDefaults,
    cvVersions,
    selectApplication,
  } = useWorkspace()
  const [pending, startTransition] = useTransition()

  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(createApplicationSchema),
    defaultValues: emptyValues(),
  })

  useEffect(() => {
    if (createOpen) form.reset(emptyValues(createDefaults.link ?? ""))
  }, [createOpen, createDefaults, form])

  function errorText(error: FormFieldError | undefined) {
    const key = ERROR_KEYS.find((item) => item === error?.message)
    return key
      ? [{ message: t(`errors.${key}`) }]
      : error
        ? [{ message: t("errors.required") }]
        : []
  }

  const onSubmit = form.handleSubmit(() => {
    const values = form.getValues()
    startTransition(async () => {
      const result = await createApplication({
        ...values,
        appliedAt: dateInputToIso(values.appliedAt),
        nextActionDueAt: dateTimeInputToIso(values.nextActionDueAt),
      })
      if (!result.ok) {
        toast.error(t("error"))
        return
      }
      toast.success(t("created", { company: values.company.trim() }))
      setCreateOpen(false)
      selectApplication(result.data.id)
    })
  })

  return (
    <Dialog open={createOpen} onOpenChange={setCreateOpen}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
        closeLabel={tCommon("close")}
      >
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">
              {t("title")}
            </DialogTitle>
            <DialogDescription>
              {createDefaults.link ? t("fromAnalyze") : t("description")}
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Controller
                control={form.control}
                name="company"
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid || undefined}>
                    <FieldLabel htmlFor="new-company">
                      {t("company")}
                    </FieldLabel>
                    <Input
                      {...field}
                      id="new-company"
                      autoComplete="organization"
                      aria-invalid={fieldState.invalid}
                      autoFocus
                    />
                    <FieldError errors={errorText(fieldState.error)} />
                  </Field>
                )}
              />
              <Controller
                control={form.control}
                name="roleTitle"
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid || undefined}>
                    <FieldLabel htmlFor="new-role">{t("role")}</FieldLabel>
                    <Input
                      {...field}
                      id="new-role"
                      aria-invalid={fieldState.invalid}
                    />
                    <FieldError errors={errorText(fieldState.error)} />
                  </Field>
                )}
              />
            </div>
            <Controller
              control={form.control}
              name="link"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid || undefined}>
                  <FieldLabel htmlFor="new-link">{t("link")}</FieldLabel>
                  <Input
                    {...field}
                    id="new-link"
                    type="url"
                    inputMode="url"
                    placeholder="https://"
                    aria-invalid={fieldState.invalid}
                  />
                  <FieldError errors={errorText(fieldState.error)} />
                </Field>
              )}
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Controller
                control={form.control}
                name="source"
                render={({ field }) => (
                  <Field>
                    <FieldLabel htmlFor="new-source">{t("source")}</FieldLabel>
                    <NativeSelect {...field} id="new-source">
                      {JOB_SOURCES.map((source) => (
                        <NativeSelectOption key={source} value={source}>
                          {tTracker(`sources.${source}`)}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </Field>
                )}
              />
              <Controller
                control={form.control}
                name="route"
                render={({ field }) => (
                  <Field>
                    <FieldLabel htmlFor="new-route">{t("route")}</FieldLabel>
                    <NativeSelect {...field} id="new-route">
                      {APPLICATION_ROUTES.map((route) => (
                        <NativeSelectOption key={route} value={route}>
                          {tTracker(`routes.${route}`)}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </Field>
                )}
              />
              <Controller
                control={form.control}
                name="status"
                render={({ field }) => (
                  <Field>
                    <FieldLabel htmlFor="new-status">{t("status")}</FieldLabel>
                    <NativeSelect {...field} id="new-status">
                      {APPLICATION_STATUSES.map((status) => (
                        <NativeSelectOption key={status} value={status}>
                          {tStatus(status)}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </Field>
                )}
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Controller
                control={form.control}
                name="appliedAt"
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid || undefined}>
                    <FieldLabel htmlFor="new-applied">
                      {t("appliedAt")}
                    </FieldLabel>
                    <Input
                      {...field}
                      id="new-applied"
                      type="date"
                      aria-invalid={fieldState.invalid}
                    />
                    <FieldError errors={errorText(fieldState.error)} />
                  </Field>
                )}
              />
              <Controller
                control={form.control}
                name="cvVersionId"
                render={({ field }) => (
                  <Field>
                    <FieldLabel htmlFor="new-cv">{t("cv")}</FieldLabel>
                    <NativeSelect {...field} id="new-cv">
                      <NativeSelectOption value="">
                        {t("cvNone")}
                      </NativeSelectOption>
                      {cvVersions.map((cv) => (
                        <NativeSelectOption key={cv.id} value={cv.id}>
                          {cv.label}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </Field>
                )}
              />
            </div>
            <Controller
              control={form.control}
              name="salaryInformed"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid || undefined}>
                  <FieldLabel htmlFor="new-salary">{t("salary")}</FieldLabel>
                  <Input
                    {...field}
                    id="new-salary"
                    aria-invalid={fieldState.invalid}
                  />
                  <FieldDescription>{t("salaryHint")}</FieldDescription>
                  <FieldError errors={errorText(fieldState.error)} />
                </Field>
              )}
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Controller
                control={form.control}
                name="nextAction"
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid || undefined}>
                    <FieldLabel htmlFor="new-next">
                      {t("nextAction")}
                    </FieldLabel>
                    <Input
                      {...field}
                      id="new-next"
                      aria-invalid={fieldState.invalid}
                    />
                    <FieldError errors={errorText(fieldState.error)} />
                  </Field>
                )}
              />
              <Controller
                control={form.control}
                name="nextActionDueAt"
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid || undefined}>
                    <FieldLabel htmlFor="new-due">{t("dueAt")}</FieldLabel>
                    <Input
                      {...field}
                      id="new-due"
                      type="datetime-local"
                      aria-invalid={fieldState.invalid}
                    />
                    <FieldError errors={errorText(fieldState.error)} />
                  </Field>
                )}
              />
            </div>
            <Controller
              control={form.control}
              name="notes"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid || undefined}>
                  <FieldLabel htmlFor="new-notes">{t("notes")}</FieldLabel>
                  <Textarea
                    {...field}
                    id="new-notes"
                    rows={3}
                    aria-invalid={fieldState.invalid}
                  />
                  <FieldError errors={errorText(fieldState.error)} />
                </Field>
              )}
            />
          </FieldGroup>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="ghost" />}>
              {t("cancel")}
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <PlusIcon data-icon="inline-start" />
              )}
              {t("submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
