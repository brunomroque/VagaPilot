"use client"

import { useId } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { PlusIcon, ShieldCheckIcon, XIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import { Controller, useForm } from "react-hook-form"

import {
  SelectField,
  useActionRunner,
  ValidationMessage,
} from "@/components/forms/fields"
import {
  addSkill,
  removeSkill,
  saveDiversity,
  setDiversityConsent,
} from "@/app/app/perfil/actions"
import type { SkillRow } from "@/lib/profile/server"
import {
  diversitySchema,
  skillSchema,
  type DiversityInput,
  type SkillInput,
} from "@/lib/profile/schemas"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@workspace/ui/components/input-group"
import { Spinner } from "@workspace/ui/components/spinner"
import { Switch } from "@workspace/ui/components/switch"

import { useProfileOptions } from "./options"
import { SectionCard } from "./section"

export function SkillsEditor({ items }: { items: SkillRow[] }) {
  const t = useTranslations("ProfilePage.skills")
  const id = useId()
  const { pending, run } = useActionRunner()
  const form = useForm<SkillInput>({
    resolver: zodResolver(skillSchema),
    defaultValues: { name: "" },
  })
  return (
    <SectionCard title={t("title")} description={t("description")}>
      <div className="flex flex-col gap-4">
        <form
          noValidate
          onSubmit={form.handleSubmit((data) =>
            run(() => addSkill(data), {
              success: t("added"),
              onSuccess: () => form.reset({ name: "" }),
            })
          )}
        >
          <Controller
            control={form.control}
            name="name"
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid || undefined}>
                <FieldLabel htmlFor={id}>{t("label")}</FieldLabel>
                <InputGroup>
                  <InputGroupInput
                    id={id}
                    {...field}
                    placeholder={t("placeholder")}
                    aria-invalid={fieldState.invalid}
                  />
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton type="submit" disabled={pending}>
                      {pending ? (
                        <Spinner data-icon="inline-start" />
                      ) : (
                        <PlusIcon data-icon="inline-start" />
                      )}
                      {t("add")}
                    </InputGroupButton>
                  </InputGroupAddon>
                </InputGroup>
                <FieldDescription>{t("hint")}</FieldDescription>
                <ValidationMessage error={fieldState.error} />
              </Field>
            )}
          />
        </form>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <ul className="flex flex-wrap gap-2" aria-label={t("title")}>
            {items.map((skill) => (
              <li key={skill.id}>
                <Badge variant="secondary" className="gap-1 pr-0.5">
                  {skill.statement}
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    disabled={pending}
                    aria-label={t("remove", { skill: skill.statement })}
                    onClick={() =>
                      run(() => removeSkill(skill.id), {
                        success: t("removed"),
                      })
                    }
                  >
                    <XIcon />
                  </Button>
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </div>
    </SectionCard>
  )
}

/** CA1.3: diversity fields stay disabled until the 'diversidade' consent is granted. */
export function DiversitySection({
  consent,
  defaults,
}: {
  consent: boolean
  defaults: DiversityInput
}) {
  const t = useTranslations("ProfilePage.diversity")
  const switchId = useId()
  const options = useProfileOptions()
  const consentRunner = useActionRunner()
  const { pending, run } = useActionRunner()
  const form = useForm<DiversityInput>({
    resolver: zodResolver(diversitySchema),
    values: defaults,
  })
  const disabled = !consent
  return (
    <SectionCard title={t("title")} description={t("description")}>
      <div className="flex flex-col gap-6">
        <Field orientation="horizontal">
          <Switch
            id={switchId}
            checked={consent}
            disabled={consentRunner.pending}
            onCheckedChange={(checked) =>
              consentRunner.run(() => setDiversityConsent(checked), {
                success: checked ? t("consentGranted") : t("consentRevoked"),
              })
            }
          />
          <FieldContent>
            <FieldLabel htmlFor={switchId}>{t("consentLabel")}</FieldLabel>
            <FieldDescription>{t("consentHint")}</FieldDescription>
          </FieldContent>
        </Field>
        {disabled ? (
          <Alert>
            <ShieldCheckIcon />
            <AlertTitle>{t("disabledTitle")}</AlertTitle>
            <AlertDescription>{t("disabledDescription")}</AlertDescription>
          </Alert>
        ) : null}
        <form
          noValidate
          onSubmit={form.handleSubmit((data) => run(() => saveDiversity(data)))}
        >
          <FieldGroup>
            <div className="grid gap-4 md:grid-cols-2">
              <SelectField
                control={form.control}
                name="gender"
                label={t("gender")}
                options={options.genders}
                disabled={disabled}
              />
              <SelectField
                control={form.control}
                name="sexualOrientation"
                label={t("orientation")}
                options={options.orientations}
                disabled={disabled}
              />
              <SelectField
                control={form.control}
                name="raceColor"
                label={t("race")}
                options={options.races}
                disabled={disabled}
              />
              <SelectField
                control={form.control}
                name="pcd"
                label={t("pcd")}
                options={options.pcd}
                disabled={disabled}
              />
            </div>
            <Field orientation="horizontal">
              <Button type="submit" disabled={disabled || pending}>
                {pending ? <Spinner data-icon="inline-start" /> : null}
                {t("save")}
              </Button>
            </Field>
          </FieldGroup>
        </form>
      </div>
    </SectionCard>
  )
}
