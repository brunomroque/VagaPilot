"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { zodResolver } from "@hookform/resolvers/zod"
import { CircleAlertIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import { Controller, useForm } from "react-hook-form"
import { z } from "zod"

import type { ConsentRequest } from "@/lib/auth/schemas"
import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
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
import { Spinner } from "@workspace/ui/components/spinner"

export function ConsentForm({
  version,
  next,
}: {
  version: "v1"
  next: string
}) {
  const t = useTranslations("Consent")
  const router = useRouter()
  const [serverError, setServerError] = useState<string>()
  const [pending, startTransition] = useTransition()

  const accepted = z.boolean().refine((value) => value, t("required"))
  const schema = z.object({ termos: accepted, privacidade: accepted })

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { termos: false, privacidade: false },
  })

  const onSubmit = form.handleSubmit(() => {
    setServerError(undefined)
    startTransition(async () => {
      const body: ConsentRequest = {
        purposes: ["termos", "privacidade"],
        version,
      }
      const response = await fetch("/api/consents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!response.ok) {
        setServerError(t("error"))
        return
      }
      router.replace(next)
      router.refresh()
    })
  })

  const documents = [
    {
      name: "termos",
      label: t("terms"),
      href: "/termos",
      link: t("termsLink"),
    },
    {
      name: "privacidade",
      label: t("privacy"),
      href: "/privacidade",
      link: t("privacyLink"),
    },
  ] as const

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1 className="text-xl font-bold">{t("title")}</h1>
        </CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate>
          <FieldGroup>
            {serverError ? (
              <Alert variant="destructive">
                <CircleAlertIcon />
                <AlertDescription>{serverError}</AlertDescription>
              </Alert>
            ) : null}
            <FieldSet>
              <FieldLegend variant="label">{t("legend")}</FieldLegend>
              <FieldDescription>{t("version", { version })}</FieldDescription>
              <FieldGroup className="gap-4">
                {documents.map((document) => (
                  <Controller
                    key={document.name}
                    control={form.control}
                    name={document.name}
                    render={({ field, fieldState }) => (
                      <Field
                        orientation="horizontal"
                        data-invalid={fieldState.invalid || undefined}
                      >
                        <Checkbox
                          id={`consent-${document.name}`}
                          name={field.name}
                          checked={field.value}
                          onCheckedChange={(checked) =>
                            field.onChange(checked === true)
                          }
                          aria-invalid={fieldState.invalid}
                        />
                        <FieldContent>
                          <FieldLabel htmlFor={`consent-${document.name}`}>
                            {document.label}
                          </FieldLabel>
                          <FieldDescription>
                            <Link
                              href={document.href}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {document.link}
                            </Link>
                          </FieldDescription>
                          <FieldError errors={[fieldState.error]} />
                        </FieldContent>
                      </Field>
                    )}
                  />
                ))}
              </FieldGroup>
            </FieldSet>
            <Field>
              <Button type="submit" size="lg" disabled={pending}>
                {pending ? <Spinner data-icon="inline-start" /> : null}
                {t("submit")}
              </Button>
            </Field>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  )
}
