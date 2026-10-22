"use client"

import { useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { PlusIcon } from "lucide-react"
import { useFormatter, useTranslations } from "next-intl"
import { useForm, useWatch } from "react-hook-form"

import {
  CheckboxField,
  SelectField,
  TextField,
  useActionRunner,
} from "@/components/forms/fields"
import {
  deleteBlockedCompany,
  deleteEducation,
  deleteExperience,
  deleteLanguage,
  deleteSalaryRule,
  deleteStandardAnswer,
  saveBlockedCompany,
  saveEducation,
  saveExperience,
  saveLanguage,
  saveSalaryRule,
  saveStandardAnswer,
} from "@/app/app/perfil/actions"
import type {
  BlockedCompanyRow,
  EducationRow,
  ExperienceRow,
  LanguageRow,
  SalaryRuleRow,
  StandardAnswerView,
} from "@/lib/profile/server"
import {
  blockedCompanySchema,
  educationSchema,
  experienceSchema,
  languageSchema,
  salaryRuleSchema,
  SENSITIVE_ANSWER_KEYS,
  standardAnswerSchema,
  STANDARD_ANSWER_PRESETS,
  type BlockedCompanyInput,
  type EducationInput,
  type ExperienceInput,
  type LanguageInput,
  type SalaryRuleInput,
  type StandardAnswerInput,
} from "@/lib/profile/schemas"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { FieldGroup } from "@workspace/ui/components/field"

import { FormDialog, monthLabel } from "./form-dialog"
import { EncryptedBadge } from "./profile-forms"
import { labelOf, useProfileOptions } from "./options"
import { EmptyList, ListItem, SectionCard } from "./section"

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button variant="outline" size="sm" onClick={onClick}>
      <PlusIcon data-icon="inline-start" />
      {label}
    </Button>
  )
}

const toMonth = (date: string | null) => (date ? date.slice(0, 7) : "")
const toYear = (date: string | null) => (date ? date.slice(0, 4) : "")

// ---------------------------------------------------------------------------
// Experiences (RF1.3, RF1A.1)
// ---------------------------------------------------------------------------

export const EMPTY_EXPERIENCE: ExperienceInput = {
  company: "",
  title: "",
  employmentType: "clt",
  startMonth: "",
  endMonth: "",
  isCurrent: false,
  location: "",
  description: "",
}

export function ExperienceDialog({
  value,
  onClose,
  onSaved,
}: {
  value: ExperienceInput | null
  onClose: () => void
  onSaved?: (id: string) => void
}) {
  const t = useTranslations("ProfilePage.experiences")
  const options = useProfileOptions()
  const { pending, run } = useActionRunner()
  const form = useForm<ExperienceInput>({
    resolver: zodResolver(experienceSchema),
    values: value ?? EMPTY_EXPERIENCE,
  })
  const isCurrent = useWatch({ control: form.control, name: "isCurrent" })
  return (
    <FormDialog
      open={value !== null}
      onOpenChange={(open) => !open && onClose()}
      title={value?.id ? t("edit") : t("add")}
      description={t("dialogDescription")}
      pending={pending}
      onSubmit={form.handleSubmit((data) =>
        run(() => saveExperience(data), {
          onSuccess: (result) => {
            onClose()
            onSaved?.(result.id)
          },
        })
      )}
    >
      <FieldGroup>
        <TextField control={form.control} name="company" label={t("company")} />
        <TextField control={form.control} name="title" label={t("role")} />
        <SelectField
          control={form.control}
          name="employmentType"
          label={t("employmentType")}
          options={options.employmentTypes}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            control={form.control}
            name="startMonth"
            type="month"
            label={t("start")}
            placeholder="2021-03"
          />
          <TextField
            control={form.control}
            name="endMonth"
            type="month"
            label={t("end")}
            placeholder="2023-08"
            disabled={isCurrent}
          />
        </div>
        <CheckboxField
          control={form.control}
          name="isCurrent"
          label={t("current")}
        />
        <TextField
          control={form.control}
          name="location"
          label={t("location")}
        />
        <TextField
          control={form.control}
          name="description"
          label={t("descriptionField")}
          multiline
        />
      </FieldGroup>
    </FormDialog>
  )
}

export function ExperiencesEditor({ items }: { items: ExperienceRow[] }) {
  const t = useTranslations("ProfilePage.experiences")
  const options = useProfileOptions()
  const [editing, setEditing] = useState<ExperienceInput | null>(null)
  const { pending, run } = useActionRunner()
  return (
    <SectionCard
      title={t("title")}
      description={t("description")}
      action={
        <AddButton
          label={t("add")}
          onClick={() => setEditing(EMPTY_EXPERIENCE)}
        />
      }
    >
      {items.length === 0 ? (
        <EmptyList title={t("empty")} description={t("emptyDescription")} />
      ) : (
        <ul className="flex flex-col divide-y">
          {items.map((item) => (
            <ListItem
              key={item.id}
              title={`${item.title} · ${item.company}`}
              pending={pending}
              meta={
                <>
                  <Badge variant="outline">
                    {labelOf(options.employmentTypes, item.employment_type)}
                  </Badge>
                  <span>
                    {monthLabel(item.start_date)} –{" "}
                    {item.is_current
                      ? t("currentShort")
                      : monthLabel(item.end_date)}
                  </span>
                  {item.location ? <span>{item.location}</span> : null}
                </>
              }
              onEdit={() =>
                setEditing({
                  id: item.id,
                  company: item.company,
                  title: item.title,
                  employmentType:
                    item.employment_type as ExperienceInput["employmentType"],
                  startMonth: toMonth(item.start_date),
                  endMonth: toMonth(item.end_date),
                  isCurrent: item.is_current === true,
                  location: item.location ?? "",
                  description: item.description ?? "",
                })
              }
              onDelete={() =>
                run(() => deleteExperience(item.id), { success: t("deleted") })
              }
            />
          ))}
        </ul>
      )}
      <ExperienceDialog value={editing} onClose={() => setEditing(null)} />
    </SectionCard>
  )
}

// ---------------------------------------------------------------------------
// Educations
// ---------------------------------------------------------------------------

const EMPTY_EDUCATION: EducationInput = {
  institution: "",
  degree: "",
  field: "",
  level: "graduacao",
  status: "concluido",
  startYear: "",
  endYear: "",
}

export function EducationsEditor({ items }: { items: EducationRow[] }) {
  const t = useTranslations("ProfilePage.educations")
  const options = useProfileOptions()
  const [editing, setEditing] = useState<EducationInput | null>(null)
  const { pending, run } = useActionRunner()
  const form = useForm<EducationInput>({
    resolver: zodResolver(educationSchema),
    values: editing ?? EMPTY_EDUCATION,
  })
  return (
    <SectionCard
      title={t("title")}
      description={t("description")}
      action={
        <AddButton
          label={t("add")}
          onClick={() => setEditing(EMPTY_EDUCATION)}
        />
      }
    >
      {items.length === 0 ? (
        <EmptyList title={t("empty")} />
      ) : (
        <ul className="flex flex-col divide-y">
          {items.map((item) => (
            <ListItem
              key={item.id}
              title={
                [item.degree, item.field].filter(Boolean).join(" · ") ||
                item.institution
              }
              pending={pending}
              meta={
                <>
                  <span>{item.institution}</span>
                  <Badge variant="outline">
                    {labelOf(options.educationStatuses, item.status)}
                  </Badge>
                  {item.end_date ? <span>{toYear(item.end_date)}</span> : null}
                </>
              }
              onEdit={() =>
                setEditing({
                  id: item.id,
                  institution: item.institution,
                  degree: item.degree ?? "",
                  field: item.field ?? "",
                  level: (item.level ?? "outro") as EducationInput["level"],
                  status: (item.status ??
                    "concluido") as EducationInput["status"],
                  startYear: toYear(item.start_date),
                  endYear: toYear(item.end_date),
                })
              }
              onDelete={() =>
                run(() => deleteEducation(item.id), { success: t("deleted") })
              }
            />
          ))}
        </ul>
      )}
      <FormDialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        title={editing?.id ? t("edit") : t("add")}
        pending={pending}
        onSubmit={form.handleSubmit((data) =>
          run(() => saveEducation(data), { onSuccess: () => setEditing(null) })
        )}
      >
        <FieldGroup>
          <TextField
            control={form.control}
            name="institution"
            label={t("institution")}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              control={form.control}
              name="degree"
              label={t("degree")}
              placeholder={t("degreePlaceholder")}
            />
            <TextField control={form.control} name="field" label={t("field")} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              control={form.control}
              name="level"
              label={t("level")}
              options={options.educationLevels}
            />
            <SelectField
              control={form.control}
              name="status"
              label={t("status")}
              options={options.educationStatuses}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              control={form.control}
              name="startYear"
              label={t("startYear")}
              inputMode="numeric"
              placeholder="2015"
            />
            <TextField
              control={form.control}
              name="endYear"
              label={t("endYear")}
              inputMode="numeric"
              placeholder="2019"
            />
          </div>
        </FieldGroup>
      </FormDialog>
    </SectionCard>
  )
}

// ---------------------------------------------------------------------------
// Languages (RF1.2: CEFR or PT label)
// ---------------------------------------------------------------------------

const EMPTY_LANGUAGE: LanguageInput = {
  language: "",
  level: "intermediario",
  cefr: "",
}

export function LanguagesEditor({ items }: { items: LanguageRow[] }) {
  const t = useTranslations("ProfilePage.languages")
  const options = useProfileOptions()
  const [editing, setEditing] = useState<LanguageInput | null>(null)
  const { pending, run } = useActionRunner()
  const form = useForm<LanguageInput>({
    resolver: zodResolver(languageSchema),
    values: editing ?? EMPTY_LANGUAGE,
  })
  return (
    <SectionCard
      title={t("title")}
      description={t("description")}
      action={
        <AddButton
          label={t("add")}
          onClick={() => setEditing(EMPTY_LANGUAGE)}
        />
      }
    >
      {items.length === 0 ? (
        <EmptyList title={t("empty")} />
      ) : (
        <ul className="flex flex-col divide-y">
          {items.map((item) => (
            <ListItem
              key={item.id}
              title={item.language}
              pending={pending}
              meta={
                <>
                  <Badge variant="secondary">
                    {labelOf(options.languageLevels, item.level)}
                  </Badge>
                  {item.cefr ? (
                    <Badge variant="outline">{item.cefr}</Badge>
                  ) : null}
                </>
              }
              onEdit={() =>
                setEditing({
                  id: item.id,
                  language: item.language,
                  level: item.level as LanguageInput["level"],
                  cefr: (item.cefr ?? "") as LanguageInput["cefr"],
                })
              }
              onDelete={() =>
                run(() => deleteLanguage(item.id), { success: t("deleted") })
              }
            />
          ))}
        </ul>
      )}
      <FormDialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        title={editing?.id ? t("edit") : t("add")}
        pending={pending}
        onSubmit={form.handleSubmit((data) =>
          run(() => saveLanguage(data), { onSuccess: () => setEditing(null) })
        )}
      >
        <FieldGroup>
          <TextField
            control={form.control}
            name="language"
            label={t("language")}
            placeholder={t("languagePlaceholder")}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              control={form.control}
              name="level"
              label={t("level")}
              options={options.languageLevels}
            />
            <SelectField
              control={form.control}
              name="cefr"
              label={t("cefr")}
              options={options.cefr}
            />
          </div>
        </FieldGroup>
      </FormDialog>
    </SectionCard>
  )
}

// ---------------------------------------------------------------------------
// Salary rules (RF1.4: seniority × regime)
// ---------------------------------------------------------------------------

const EMPTY_SALARY: SalaryRuleInput = {
  seniority: "senior",
  regime: "clt",
  amountMin: "",
  amountTarget: "",
  currency: "BRL",
  period: "mensal",
}

export function SalaryRulesEditor({ items }: { items: SalaryRuleRow[] }) {
  const t = useTranslations("ProfilePage.salary")
  const format = useFormatter()
  const options = useProfileOptions()
  const [editing, setEditing] = useState<SalaryRuleInput | null>(null)
  const { pending, run } = useActionRunner()
  const form = useForm<SalaryRuleInput>({
    resolver: zodResolver(salaryRuleSchema),
    values: editing ?? EMPTY_SALARY,
  })
  const money = (value: number | null, currency: string | null) =>
    value === null
      ? ""
      : format.number(Number(value), {
          style: "currency",
          currency: currency ?? "BRL",
          maximumFractionDigits: 0,
        })
  return (
    <SectionCard
      title={t("title")}
      description={t("description")}
      action={
        <AddButton label={t("add")} onClick={() => setEditing(EMPTY_SALARY)} />
      }
    >
      {items.length === 0 ? (
        <EmptyList title={t("empty")} description={t("emptyDescription")} />
      ) : (
        <ul className="flex flex-col divide-y">
          {items.map((item) => (
            <ListItem
              key={item.id}
              title={`${labelOf(options.seniorities, item.seniority)} · ${labelOf(options.regimes, item.regime)}`}
              pending={pending}
              meta={
                <>
                  {item.amount_min !== null ? (
                    <span>
                      {t("minValue", {
                        value: money(item.amount_min, item.currency),
                      })}
                    </span>
                  ) : null}
                  <span>
                    {t("targetValue", {
                      value: money(item.amount_target, item.currency),
                    })}
                  </span>
                  <Badge variant="outline">
                    {labelOf(options.periods, item.period)}
                  </Badge>
                </>
              }
              onEdit={() =>
                setEditing({
                  id: item.id,
                  seniority: item.seniority as SalaryRuleInput["seniority"],
                  regime: item.regime as SalaryRuleInput["regime"],
                  amountMin:
                    item.amount_min === null ? "" : String(item.amount_min),
                  amountTarget: String(item.amount_target),
                  currency: (item.currency ??
                    "BRL") as SalaryRuleInput["currency"],
                  period: (item.period ??
                    "mensal") as SalaryRuleInput["period"],
                })
              }
              onDelete={() =>
                run(() => deleteSalaryRule(item.id), { success: t("deleted") })
              }
            />
          ))}
        </ul>
      )}
      <FormDialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        title={editing?.id ? t("edit") : t("add")}
        description={t("dialogDescription")}
        pending={pending}
        onSubmit={form.handleSubmit((data) =>
          run(() => saveSalaryRule(data), { onSuccess: () => setEditing(null) })
        )}
      >
        <FieldGroup>
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              control={form.control}
              name="seniority"
              label={t("seniority")}
              options={options.seniorities}
            />
            <SelectField
              control={form.control}
              name="regime"
              label={t("regime")}
              options={options.regimes}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              control={form.control}
              name="amountMin"
              label={t("min")}
              inputMode="decimal"
              placeholder="25.000"
            />
            <TextField
              control={form.control}
              name="amountTarget"
              label={t("target")}
              inputMode="decimal"
              placeholder="30.000"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              control={form.control}
              name="currency"
              label={t("currency")}
              options={options.currencies}
            />
            <SelectField
              control={form.control}
              name="period"
              label={t("period")}
              options={options.periods}
            />
          </div>
        </FieldGroup>
      </FormDialog>
    </SectionCard>
  )
}

// ---------------------------------------------------------------------------
// Standard answers (RF1.6, RF1A.4)
// ---------------------------------------------------------------------------

const EMPTY_ANSWER: StandardAnswerInput = {
  key: "disponibilidade_inicio",
  question: "",
  answer: "",
  isSensitive: false,
  language: "pt-BR",
}

export function StandardAnswersEditor({
  items,
}: {
  items: StandardAnswerView[]
}) {
  const t = useTranslations("ProfilePage.answers")
  const tKeys = useTranslations("ProfileOptions.answerKey")
  const options = useProfileOptions()
  const [editing, setEditing] = useState<StandardAnswerInput | null>(null)
  const { pending, run } = useActionRunner()
  const form = useForm<StandardAnswerInput>({
    resolver: zodResolver(standardAnswerSchema),
    values: editing ?? EMPTY_ANSWER,
  })
  const key = useWatch({ control: form.control, name: "key" })
  const keyLabel = (value: string) =>
    (STANDARD_ANSWER_PRESETS as readonly string[]).includes(value) ||
    value === "remuneracao_atual"
      ? tKeys(
          value as
            (typeof STANDARD_ANSWER_PRESETS)[number] | "remuneracao_atual"
        )
      : value
  return (
    <SectionCard
      title={t("title")}
      description={t("description")}
      action={
        <AddButton label={t("add")} onClick={() => setEditing(EMPTY_ANSWER)} />
      }
    >
      {items.length === 0 ? (
        <EmptyList title={t("empty")} description={t("emptyDescription")} />
      ) : (
        <ul className="flex flex-col divide-y">
          {items.map((item) => (
            <ListItem
              key={item.id}
              title={keyLabel(item.key)}
              pending={pending}
              meta={
                <>
                  {item.isSensitive ? (
                    <EncryptedBadge />
                  ) : (
                    <span className="break-words">{item.answer}</span>
                  )}
                  <Badge variant="outline">
                    {labelOf(options.cvLanguages, item.language)}
                  </Badge>
                </>
              }
              onEdit={() =>
                setEditing({
                  id: item.id,
                  key: item.key,
                  question: item.question,
                  answer: item.answer,
                  isSensitive: item.isSensitive,
                  language: item.language as StandardAnswerInput["language"],
                })
              }
              onDelete={() =>
                run(() => deleteStandardAnswer(item.id), {
                  success: t("deleted"),
                })
              }
            />
          ))}
        </ul>
      )}
      <FormDialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        title={editing?.id ? t("edit") : t("add")}
        pending={pending}
        onSubmit={form.handleSubmit((data) =>
          run(() => saveStandardAnswer(data), {
            onSuccess: () => setEditing(null),
          })
        )}
      >
        <FieldGroup>
          <TextField
            control={form.control}
            name="key"
            label={t("key")}
            description={t("keyHint", {
              examples: STANDARD_ANSWER_PRESETS.slice(0, 4).join(", "),
            })}
          />
          <TextField
            control={form.control}
            name="question"
            label={t("question")}
            placeholder={t("questionPlaceholder")}
          />
          <TextField
            control={form.control}
            name="answer"
            label={t("answer")}
            multiline
          />
          <SelectField
            control={form.control}
            name="language"
            label={t("language")}
            options={options.cvLanguages}
          />
          <CheckboxField
            control={form.control}
            name="isSensitive"
            label={t("sensitive")}
            description={
              SENSITIVE_ANSWER_KEYS.has(key)
                ? t("sensitiveForced")
                : t("sensitiveHint")
            }
          />
        </FieldGroup>
      </FormDialog>
    </SectionCard>
  )
}

// ---------------------------------------------------------------------------
// Blocked companies (RF1.5, CA1.4)
// ---------------------------------------------------------------------------

const EMPTY_BLOCKED: BlockedCompanyInput = {
  companyName: "",
  aliases: "",
  domains: "",
  reason: "",
}

export function BlocklistEditor({ items }: { items: BlockedCompanyRow[] }) {
  const t = useTranslations("ProfilePage.blocklist")
  const [editing, setEditing] = useState<BlockedCompanyInput | null>(null)
  const { pending, run } = useActionRunner()
  const form = useForm<BlockedCompanyInput>({
    resolver: zodResolver(blockedCompanySchema),
    values: editing ?? EMPTY_BLOCKED,
  })
  return (
    <SectionCard
      title={t("title")}
      description={t("description")}
      action={
        <AddButton label={t("add")} onClick={() => setEditing(EMPTY_BLOCKED)} />
      }
    >
      {items.length === 0 ? (
        <EmptyList title={t("empty")} description={t("emptyDescription")} />
      ) : (
        <ul className="flex flex-col divide-y">
          {items.map((item) => (
            <ListItem
              key={item.id}
              title={item.company_name}
              pending={pending}
              meta={
                <>
                  {[...(item.aliases ?? []), ...(item.domains ?? [])].map(
                    (value) => (
                      <Badge key={value} variant="outline">
                        {value}
                      </Badge>
                    )
                  )}
                  {item.reason ? <span>{item.reason}</span> : null}
                </>
              }
              onEdit={() =>
                setEditing({
                  id: item.id,
                  companyName: item.company_name,
                  aliases: (item.aliases ?? []).join(", "),
                  domains: (item.domains ?? []).join(", "),
                  reason: item.reason ?? "",
                })
              }
              onDelete={() =>
                run(() => deleteBlockedCompany(item.id), {
                  success: t("deleted"),
                })
              }
            />
          ))}
        </ul>
      )}
      <FormDialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        title={editing?.id ? t("edit") : t("add")}
        description={t("dialogDescription")}
        pending={pending}
        onSubmit={form.handleSubmit((data) =>
          run(() => saveBlockedCompany(data), {
            onSuccess: () => setEditing(null),
          })
        )}
      >
        <FieldGroup>
          <TextField
            control={form.control}
            name="companyName"
            label={t("company")}
            placeholder="Acme"
          />
          <TextField
            control={form.control}
            name="aliases"
            label={t("aliases")}
            description={t("listHint")}
          />
          <TextField
            control={form.control}
            name="domains"
            label={t("domains")}
            description={t("listHint")}
            placeholder="acme.com.br"
          />
          <TextField control={form.control} name="reason" label={t("reason")} />
        </FieldGroup>
      </FormDialog>
    </SectionCard>
  )
}
