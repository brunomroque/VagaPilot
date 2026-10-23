"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { LockIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import { useForm, useWatch } from "react-hook-form"

import { FilledViaChatBadgeClient } from "@/components/chat/filled-via-chat-badge-client"
import {
  CheckboxGroupField,
  SelectField,
  TextField,
  useActionRunner,
} from "@/components/forms/fields"
import {
  saveAddress,
  saveContact,
  saveDocuments,
  savePreferences,
  saveSituation,
} from "@/app/app/perfil/actions"
import {
  addressSchema,
  contactSchema,
  documentsSchema,
  preferencesSchema,
  situationSchema,
  type AddressInput,
  type ContactInput,
  type DocumentsInput,
  type PreferencesInput,
  type SituationInput,
} from "@/lib/profile/schemas"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Field, FieldGroup } from "@workspace/ui/components/field"
import { Spinner } from "@workspace/ui/components/spinner"

import { useProfileOptions } from "./options"
import { SectionCard } from "./section"

function ChatProvenanceBadge({ profileUserId }: { profileUserId?: string }) {
  if (!profileUserId) return null
  return (
    <FilledViaChatBadgeClient
      tableName="candidate_profiles"
      recordId={profileUserId}
    />
  )
}

function SubmitButton({
  pending,
  label,
}: {
  pending: boolean
  label?: string
}) {
  const t = useTranslations("Forms")
  return (
    <Field orientation="horizontal">
      <Button type="submit" disabled={pending}>
        {pending ? <Spinner data-icon="inline-start" /> : null}
        {label ?? t("save")}
      </Button>
    </Field>
  )
}

export function EncryptedBadge() {
  const t = useTranslations("ProfilePage")
  return (
    <Badge variant="secondary">
      <LockIcon data-icon="inline-start" />
      {t("encrypted")}
    </Badge>
  )
}

export function ContactForm({
  defaults,
  profileUserId,
}: {
  defaults: ContactInput
  profileUserId?: string
}) {
  const t = useTranslations("ProfilePage.contact")
  const { pending, run } = useActionRunner()
  const form = useForm<ContactInput>({
    resolver: zodResolver(contactSchema),
    defaultValues: defaults,
  })
  return (
    <SectionCard
      title={t("title")}
      description={
        <>
          {t("description")}
          <span className="mt-2 block">
            <ChatProvenanceBadge profileUserId={profileUserId} />
          </span>
        </>
      }
    >
      <form
        noValidate
        onSubmit={form.handleSubmit((data) => run(() => saveContact(data)))}
      >
        <FieldGroup>
          <div className="grid gap-4 md:grid-cols-2">
            <TextField
              control={form.control}
              name="firstName"
              label={t("firstName")}
              autoComplete="given-name"
            />
            <TextField
              control={form.control}
              name="lastName"
              label={t("lastName")}
              autoComplete="family-name"
            />
          </div>
          <TextField
            control={form.control}
            name="displayName"
            label={t("displayName")}
            description={t("displayNameHint")}
          />
          <div className="grid gap-4 md:grid-cols-2">
            <TextField
              control={form.control}
              name="emailContact"
              type="email"
              label={t("email")}
              autoComplete="email"
            />
            <TextField
              control={form.control}
              name="phone"
              type="tel"
              label={t("phone")}
              autoComplete="tel"
              description={<EncryptedBadge />}
            />
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <TextField
              control={form.control}
              name="city"
              label={t("city")}
              autoComplete="address-level2"
            />
            <TextField
              control={form.control}
              name="state"
              label={t("state")}
              placeholder="SP"
              autoComplete="address-level1"
            />
            <TextField
              control={form.control}
              name="birthDate"
              type="date"
              label={t("birthDate")}
              description={<EncryptedBadge />}
            />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <TextField
              control={form.control}
              name="linkedinUrl"
              type="url"
              label={t("linkedin")}
              placeholder="https://www.linkedin.com/in/..."
            />
            <TextField
              control={form.control}
              name="portfolioUrl"
              type="url"
              label={t("portfolio")}
              placeholder="https://"
            />
          </div>
          <TextField
            control={form.control}
            name="cvFilenamePattern"
            label={t("cvPattern")}
            description={t("cvPatternHint")}
          />
          <SubmitButton pending={pending} />
        </FieldGroup>
      </form>
    </SectionCard>
  )
}

export function AddressForm({ defaults }: { defaults: AddressInput }) {
  const t = useTranslations("ProfilePage.address")
  const { pending, run } = useActionRunner()
  const form = useForm<AddressInput>({
    resolver: zodResolver(addressSchema),
    defaultValues: defaults,
  })
  return (
    <SectionCard
      title={t("title")}
      description={t("description")}
      action={<EncryptedBadge />}
    >
      <form
        noValidate
        onSubmit={form.handleSubmit((data) => run(() => saveAddress(data)))}
      >
        <FieldGroup>
          <div className="grid gap-4 md:grid-cols-3">
            <TextField
              control={form.control}
              name="postalCode"
              label={t("postalCode")}
              autoComplete="postal-code"
              inputMode="numeric"
            />
            <div className="md:col-span-2">
              <TextField
                control={form.control}
                name="street"
                label={t("street")}
                autoComplete="address-line1"
              />
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <TextField
              control={form.control}
              name="number"
              label={t("number")}
            />
            <TextField
              control={form.control}
              name="complement"
              label={t("complement")}
              autoComplete="address-line2"
            />
            <TextField
              control={form.control}
              name="district"
              label={t("district")}
            />
          </div>
          <SubmitButton pending={pending} />
        </FieldGroup>
      </form>
    </SectionCard>
  )
}

export function DocumentsForm({ defaults }: { defaults: DocumentsInput }) {
  const t = useTranslations("ProfilePage.documents")
  const { pending, run } = useActionRunner()
  const form = useForm<DocumentsInput>({
    resolver: zodResolver(documentsSchema),
    defaultValues: defaults,
  })
  return (
    <SectionCard
      title={t("title")}
      description={t("description")}
      action={<EncryptedBadge />}
    >
      <form
        noValidate
        onSubmit={form.handleSubmit((data) => run(() => saveDocuments(data)))}
      >
        <FieldGroup>
          <div className="grid gap-4 md:grid-cols-3">
            <TextField
              control={form.control}
              name="cpf"
              label={t("cpf")}
              placeholder="000.000.000-00"
              inputMode="numeric"
            />
            <TextField control={form.control} name="rg" label={t("rg")} />
            <TextField control={form.control} name="cnh" label={t("cnh")} />
          </div>
          <SubmitButton pending={pending} />
        </FieldGroup>
      </form>
    </SectionCard>
  )
}

export function SituationForm({ defaults }: { defaults: SituationInput }) {
  const t = useTranslations("ProfilePage.situation")
  const options = useProfileOptions()
  const { pending, run } = useActionRunner()
  const form = useForm<SituationInput>({
    resolver: zodResolver(situationSchema),
    defaultValues: defaults,
  })
  const payMode = useWatch({ control: form.control, name: "currentPayMode" })
  return (
    <SectionCard title={t("title")} description={t("description")}>
      <form
        noValidate
        onSubmit={form.handleSubmit((data) => run(() => saveSituation(data)))}
      >
        <FieldGroup>
          <div className="grid gap-4 md:grid-cols-2">
            <SelectField
              control={form.control}
              name="situation"
              label={t("situation")}
              options={options.situations}
            />
            <TextField
              control={form.control}
              name="currentCompany"
              label={t("currentCompany")}
              description={t("currentCompanyHint")}
            />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <SelectField
              control={form.control}
              name="currentPayMode"
              label={t("payMode")}
              options={options.payModes}
            />
            {payMode === "informar" ? (
              <TextField
                control={form.control}
                name="currentPay"
                label={t("currentPay")}
                inputMode="decimal"
                placeholder="12.000,00"
                description={<EncryptedBadge />}
              />
            ) : null}
          </div>
          <SubmitButton pending={pending} />
        </FieldGroup>
      </form>
    </SectionCard>
  )
}

export function PreferencesForm({
  defaults,
  onSaved,
  submitLabel,
}: {
  defaults: PreferencesInput
  onSaved?: () => void
  submitLabel?: string
}) {
  const t = useTranslations("ProfilePage.preferences")
  const options = useProfileOptions()
  const { pending, run } = useActionRunner()
  const form = useForm<PreferencesInput>({
    resolver: zodResolver(preferencesSchema),
    defaultValues: defaults,
  })
  return (
    <SectionCard title={t("title")} description={t("description")}>
      <form
        noValidate
        onSubmit={form.handleSubmit((data) =>
          run(() => savePreferences(data), { onSuccess: onSaved })
        )}
      >
        <FieldGroup>
          <CheckboxGroupField
            control={form.control}
            name="workModels"
            label={t("workModels")}
            options={options.workModels}
          />
          <CheckboxGroupField
            control={form.control}
            name="regimes"
            label={t("regimes")}
            description={t("regimesHint")}
            options={options.regimes}
          />
          <TextField
            control={form.control}
            name="cities"
            label={t("cities")}
            description={t("citiesHint")}
            placeholder="São Paulo, Campinas"
          />
          <div className="grid gap-4 md:grid-cols-3">
            <SelectField
              control={form.control}
              name="availability"
              label={t("availability")}
              options={options.availability}
            />
            <SelectField
              control={form.control}
              name="travel"
              label={t("travel")}
              options={options.yesNoMaybe}
            />
            <SelectField
              control={form.control}
              name="relocation"
              label={t("relocation")}
              options={options.yesNoMaybe}
            />
          </div>
          <SubmitButton pending={pending} label={submitLabel} />
        </FieldGroup>
      </form>
    </SectionCard>
  )
}
