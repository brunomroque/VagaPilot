"use client"

import { useMemo, useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import {
  BriefcaseBusinessIcon,
  CheckIcon,
  PencilIcon,
  QuoteIcon,
  UserPlusIcon,
  XIcon,
} from "lucide-react"
import { useTranslations } from "next-intl"
import { useForm } from "react-hook-form"
import { z } from "zod"

import { FilledViaChatBadgeClient } from "@/components/chat/filled-via-chat-badge-client"
import {
  SelectField,
  TextField,
  useActionRunner,
} from "@/components/forms/fields"
import { FormDialog } from "@/components/profile/form-dialog"
import {
  EMPTY_EXPERIENCE,
  ExperienceDialog,
} from "@/components/profile/list-editors"
import {
  confirmFacts,
  editAndConfirmFact,
  linkFactsToExperience,
  rejectFacts,
} from "@/app/app/fatos/actions"
import type { FactGroup, FactView } from "@/lib/facts/server"
import type { ExperienceInput } from "@/lib/profile/schemas"
import { FACT_KINDS, type FactStatus } from "@vagapilot/core/facts"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Checkbox } from "@workspace/ui/components/checkbox"
import { FieldGroup } from "@workspace/ui/components/field"

const editSchema = z.object({
  statement: z.string().trim().min(2, "required").max(500, "tooLong"),
  kind: z.enum(FACT_KINDS),
})
type EditValues = z.infer<typeof editSchema>

function hintToExperience(group: FactGroup): ExperienceInput {
  const hint = group.hint
  return {
    ...EMPTY_EXPERIENCE,
    company: hint?.company ?? "",
    title: hint?.title ?? "",
    startMonth: hint?.start_month ?? "",
    endMonth: hint?.end_month ?? "",
    isCurrent: hint?.is_current === true,
  }
}

export function FactReview({
  groups,
  status,
}: {
  groups: FactGroup[]
  status: FactStatus
}) {
  const t = useTranslations("Facts")
  const tKind = useTranslations("Facts.kinds")
  const { pending, run } = useActionRunner()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<FactView | null>(null)
  const [addingFor, setAddingFor] = useState<FactGroup | null>(null)

  const allIds = useMemo(
    () => groups.flatMap((group) => group.facts.map((fact) => fact.id)),
    [groups]
  )
  const visibleSelected = allIds.filter((id) => selected.has(id))
  const allChecked =
    allIds.length > 0 && visibleSelected.length === allIds.length

  const kindOptions = FACT_KINDS.map((kind) => ({
    value: kind,
    label: tKind(kind),
  }))
  const form = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    values: editing
      ? { statement: editing.statement, kind: editing.kind }
      : { statement: "", kind: "conquista" },
  })

  function toggle(id: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  function confirm(ids: string[]) {
    run(() => confirmFacts(ids), {
      success: t("confirmed", { count: ids.length }),
      onSuccess: () => setSelected(new Set()),
    })
  }

  function reject(ids: string[]) {
    run(() => rejectFacts(ids), {
      success: t("rejected", { count: ids.length }),
      onSuccess: () => setSelected(new Set()),
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          <Checkbox
            checked={allChecked}
            onCheckedChange={(checked) =>
              setSelected(checked === true ? new Set(allIds) : new Set())
            }
            aria-label={t("selectAll")}
          />
          {t("selectedCount", {
            count: visibleSelected.length,
            total: allIds.length,
          })}
        </label>
        <div className="flex flex-wrap gap-2">
          {status !== "confirmado" ? (
            <Button
              size="sm"
              disabled={pending || visibleSelected.length === 0}
              onClick={() => confirm(visibleSelected)}
            >
              <CheckIcon data-icon="inline-start" />
              {t("confirmSelected")}
            </Button>
          ) : null}
          {status !== "rejeitado" ? (
            <Button
              size="sm"
              variant="outline"
              disabled={pending || visibleSelected.length === 0}
              onClick={() => reject(visibleSelected)}
            >
              <XIcon data-icon="inline-start" />
              {t("rejectSelected")}
            </Button>
          ) : null}
        </div>
      </div>

      {groups.map((group) => {
        const ids = group.facts.map((fact) => fact.id)
        const heading =
          group.key === "other"
            ? t("otherGroup")
            : [group.title, group.subtitle].filter(Boolean).join(" · ")
        return (
          <Card key={group.key} role="region" aria-label={heading}>
            <CardHeader>
              <CardTitle>
                <h3 className="flex items-center gap-2 text-base font-bold">
                  <BriefcaseBusinessIcon
                    className="text-muted-foreground"
                    aria-hidden
                  />
                  {heading}
                </h3>
              </CardTitle>
              <CardDescription className="flex flex-wrap items-center gap-2">
                {group.experienceId ? (
                  <Badge variant="secondary">{t("linked")}</Badge>
                ) : group.hint ? (
                  <Badge variant="outline">{t("detected")}</Badge>
                ) : (
                  t("otherDescription")
                )}
                <span>{t("factCount", { count: group.facts.length })}</span>
              </CardDescription>
              <CardAction className="flex flex-wrap gap-2">
                {group.hint && !group.experienceId ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setAddingFor(group)}
                  >
                    <UserPlusIcon data-icon="inline-start" />
                    {t("addExperience")}
                  </Button>
                ) : null}
                {status !== "confirmado" ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={pending}
                    onClick={() => confirm(ids)}
                  >
                    {t("confirmGroup")}
                  </Button>
                ) : null}
              </CardAction>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col divide-y">
                {group.facts.map((fact) => (
                  <li
                    key={fact.id}
                    className="flex flex-wrap items-start gap-3 py-3"
                  >
                    <Checkbox
                      className="mt-1"
                      checked={selected.has(fact.id)}
                      onCheckedChange={(checked) =>
                        toggle(fact.id, checked === true)
                      }
                      aria-label={t("select", { fact: fact.statement })}
                    />
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <p className="font-medium break-words">
                        {fact.statement}
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{tKind(fact.kind)}</Badge>
                        <FilledViaChatBadgeClient
                          tableName="confirmed_facts"
                          recordId={fact.id}
                        />
                        {fact.edited ? (
                          <Badge variant="secondary">{t("edited")}</Badge>
                        ) : null}
                        {fact.source === "manual" ? (
                          <Badge variant="secondary">{t("manual")}</Badge>
                        ) : null}
                      </div>
                      {fact.excerpt ? (
                        <p className="flex gap-1.5 text-sm text-muted-foreground">
                          <QuoteIcon
                            className="mt-0.5 size-3.5 shrink-0"
                            aria-hidden
                          />
                          <span className="break-words">
                            <span className="sr-only">{t("excerpt")}: </span>
                            {fact.excerpt}
                          </span>
                        </p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {status !== "confirmado" ? (
                        <Button
                          size="sm"
                          disabled={pending}
                          onClick={() => confirm([fact.id])}
                          aria-label={t("confirmOne", { fact: fact.statement })}
                        >
                          <CheckIcon data-icon="inline-start" />
                          {t("confirm")}
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() => setEditing(fact)}
                        aria-label={t("editOne", { fact: fact.statement })}
                      >
                        <PencilIcon data-icon="inline-start" />
                        {t("edit")}
                      </Button>
                      {status !== "rejeitado" ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={pending}
                          onClick={() => reject([fact.id])}
                          aria-label={t("rejectOne", { fact: fact.statement })}
                        >
                          <XIcon data-icon="inline-start" />
                          {t("reject")}
                        </Button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )
      })}

      <FormDialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        title={t("editTitle")}
        description={t("editDescription")}
        submitLabel={t("editSubmit")}
        pending={pending}
        onSubmit={form.handleSubmit((data) => {
          if (!editing) return
          run(() => editAndConfirmFact({ id: editing.id, ...data }), {
            success: t("confirmed", { count: 1 }),
            onSuccess: () => setEditing(null),
          })
        })}
      >
        <FieldGroup>
          {editing?.excerpt ? (
            <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">
                {t("excerpt")}:{" "}
              </span>
              {editing.excerpt}
            </p>
          ) : null}
          <TextField
            control={form.control}
            name="statement"
            label={t("statement")}
            multiline
          />
          <SelectField
            control={form.control}
            name="kind"
            label={t("kind")}
            options={kindOptions}
          />
        </FieldGroup>
      </FormDialog>

      <ExperienceDialog
        value={addingFor ? hintToExperience(addingFor) : null}
        onClose={() => setAddingFor(null)}
        onSaved={(experienceId) => {
          const ids = addingFor?.facts.map((fact) => fact.id) ?? []
          if (ids.length > 0)
            run(() => linkFactsToExperience(experienceId, ids))
        }}
      />
    </div>
  )
}
