"use client"

import { useId, useTransition, type ReactNode } from "react"
import { useTranslations } from "next-intl"
import {
  Controller,
  type Control,
  type FieldError as HookFieldError,
  type FieldPath,
  type FieldValues,
} from "react-hook-form"
import { toast } from "sonner"

import type { ActionResult } from "@/lib/action-result"
import { Checkbox } from "@workspace/ui/components/checkbox"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import {
  NativeSelect,
  NativeSelectOption,
} from "@workspace/ui/components/native-select"
import { Textarea } from "@workspace/ui/components/textarea"

export type Option = { value: string; label: string }

const VALIDATION_KEYS = [
  "required",
  "tooLong",
  "invalidUrl",
  "invalidEmail",
  "invalidPhone",
  "invalidDate",
  "invalidState",
  "invalidMonth",
  "invalidYear",
  "invalidCpf",
  "invalidAmount",
  "invalidKey",
  "endRequired",
  "endBeforeStart",
  "minAboveTarget",
  "pickOne",
  "patternNeedsName",
] as const
type ValidationKey = (typeof VALIDATION_KEYS)[number]

function isValidationKey(value: string | undefined): value is ValidationKey {
  return (VALIDATION_KEYS as readonly string[]).includes(value ?? "")
}

/** Translates Zod message keys from lib/profile/schemas.ts. */
export function ValidationMessage({ error }: { error?: HookFieldError }) {
  const t = useTranslations("Forms.validation")
  if (!error) return null
  const message = isValidationKey(error.message)
    ? t(error.message)
    : t("invalid")
  return <FieldError errors={[{ message }]} />
}

type BaseFieldProps<T extends FieldValues> = {
  control: Control<T>
  name: FieldPath<T>
  label: string
  description?: ReactNode
  disabled?: boolean
}

export function TextField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  disabled,
  type = "text",
  placeholder,
  autoComplete,
  multiline,
  inputMode,
}: BaseFieldProps<T> & {
  type?: "text" | "email" | "url" | "tel" | "date" | "month"
  placeholder?: string
  autoComplete?: string
  multiline?: boolean
  inputMode?: "numeric" | "decimal" | "text"
}) {
  const id = useId()
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field
          data-invalid={fieldState.invalid || undefined}
          data-disabled={disabled || undefined}
        >
          <FieldLabel htmlFor={id}>{label}</FieldLabel>
          {multiline ? (
            <Textarea
              id={id}
              name={field.name}
              value={(field.value as string | undefined) ?? ""}
              onChange={field.onChange}
              onBlur={field.onBlur}
              ref={field.ref}
              placeholder={placeholder}
              disabled={disabled}
              aria-invalid={fieldState.invalid}
            />
          ) : (
            <Input
              id={id}
              name={field.name}
              type={type}
              value={(field.value as string | undefined) ?? ""}
              onChange={field.onChange}
              onBlur={field.onBlur}
              ref={field.ref}
              placeholder={placeholder}
              autoComplete={autoComplete}
              inputMode={inputMode}
              disabled={disabled}
              aria-invalid={fieldState.invalid}
            />
          )}
          {description ? (
            <FieldDescription>{description}</FieldDescription>
          ) : null}
          <ValidationMessage error={fieldState.error} />
        </Field>
      )}
    />
  )
}

export function SelectField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  disabled,
  options,
}: BaseFieldProps<T> & { options: readonly Option[] }) {
  const id = useId()
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field
          data-invalid={fieldState.invalid || undefined}
          data-disabled={disabled || undefined}
        >
          <FieldLabel htmlFor={id}>{label}</FieldLabel>
          <NativeSelect
            id={id}
            className="w-full"
            name={field.name}
            value={(field.value as string | undefined) ?? ""}
            onChange={field.onChange}
            onBlur={field.onBlur}
            ref={field.ref}
            disabled={disabled}
            aria-invalid={fieldState.invalid}
          >
            {options.map((option) => (
              <NativeSelectOption key={option.value} value={option.value}>
                {option.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          {description ? (
            <FieldDescription>{description}</FieldDescription>
          ) : null}
          <ValidationMessage error={fieldState.error} />
        </Field>
      )}
    />
  )
}

export function CheckboxField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  disabled,
}: BaseFieldProps<T>) {
  const id = useId()
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <Field orientation="horizontal" data-disabled={disabled || undefined}>
          <Checkbox
            id={id}
            name={field.name}
            checked={field.value === true}
            onCheckedChange={(checked) => field.onChange(checked === true)}
            disabled={disabled}
          />
          <FieldContent>
            <FieldLabel htmlFor={id}>{label}</FieldLabel>
            {description ? (
              <FieldDescription>{description}</FieldDescription>
            ) : null}
          </FieldContent>
        </Field>
      )}
    />
  )
}

export function CheckboxGroupField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  disabled,
  options,
}: BaseFieldProps<T> & { options: readonly Option[] }) {
  const id = useId()
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        const values = (field.value as string[] | undefined) ?? []
        return (
          <FieldSet data-invalid={fieldState.invalid || undefined}>
            <FieldLegend variant="label">{label}</FieldLegend>
            {description ? (
              <FieldDescription>{description}</FieldDescription>
            ) : null}
            <FieldGroup className="flex-row flex-wrap gap-4">
              {options.map((option) => {
                const optionId = `${id}-${option.value}`
                return (
                  <Field
                    key={option.value}
                    orientation="horizontal"
                    className="w-auto"
                  >
                    <Checkbox
                      id={optionId}
                      checked={values.includes(option.value)}
                      disabled={disabled}
                      aria-invalid={fieldState.invalid}
                      onCheckedChange={(checked) =>
                        field.onChange(
                          checked === true
                            ? [...values, option.value]
                            : values.filter((value) => value !== option.value)
                        )
                      }
                    />
                    <FieldLabel htmlFor={optionId} className="font-normal">
                      {option.label}
                    </FieldLabel>
                  </Field>
                )
              })}
            </FieldGroup>
            <ValidationMessage error={fieldState.error} />
          </FieldSet>
        )
      }}
    />
  )
}

/** Runs a server action in a transition and reports the outcome with a toast. */
export function useActionRunner() {
  const t = useTranslations("Forms")
  const [pending, startTransition] = useTransition()

  function run<R>(
    action: () => Promise<ActionResult<R>>,
    options: { success?: string; onSuccess?: (data: R) => void } = {}
  ) {
    startTransition(async () => {
      try {
        const result = await action()
        if (result.ok) {
          toast.success(options.success ?? t("saved"))
          options.onSuccess?.(result.data)
        } else {
          toast.error(t(`errors.${result.error.code}`))
        }
      } catch {
        toast.error(t("errors.internal_error"))
      }
    })
  }

  return { pending, run }
}
