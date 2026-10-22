"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { zodResolver } from "@hookform/resolvers/zod"
import { CircleAlertIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import { Controller, useForm } from "react-hook-form"
import { z } from "zod"

import {
  signInWithGoogle,
  signInWithPassword,
  signUpWithPassword,
} from "@/app/(auth)/actions"
import type { AuthActionResult } from "@/lib/auth/schemas"
import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import { Button, buttonVariants } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import { Spinner } from "@workspace/ui/components/spinner"

type Mode = "login" | "signup"

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" data-icon="inline-start">
      <path
        fill="currentColor"
        d="M12.48 10.92v3.28h7.84c-.24 1.84-.85 3.18-1.73 4.1-1.05 1.05-2.69 2.2-5.53 2.2-4.4 0-7.84-3.55-7.84-7.95s3.44-7.95 7.84-7.95c2.38 0 4.1.94 5.38 2.13l2.31-2.31C18.75 2.36 16.13 1 12.48 1 6.27 1 1.17 6.03 1.17 12.24s5.1 11.24 11.31 11.24c3.36 0 5.89-1.1 7.87-3.17 2.04-2.04 2.68-4.92 2.68-7.24 0-.72-.05-1.39-.16-1.95z"
      />
    </svg>
  )
}

export function CredentialsForm({
  mode,
  next,
  initialError,
}: {
  mode: Mode
  next?: string
  initialError?: string
}) {
  const t = useTranslations("Auth")
  const [serverError, setServerError] = useState<string | undefined>(
    initialError
  )
  const [pending, startTransition] = useTransition()
  const [googlePending, startGoogle] = useTransition()

  const schema = z.object({
    email: z.email(t("validation.email")),
    password: z.string().min(8, t("validation.passwordMin")).max(72),
  })

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  })

  function handleResult(result: AuthActionResult) {
    if (result?.error) setServerError(result.error.message)
  }

  const onSubmit = form.handleSubmit((values) => {
    setServerError(undefined)
    startTransition(async () => {
      handleResult(
        mode === "login"
          ? await signInWithPassword(values, next)
          : await signUpWithPassword(values)
      )
    })
  })

  const copy = mode === "login" ? "login" : "signup"

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1 className="text-xl font-bold">{t(`${copy}.title`)}</h1>
        </CardTitle>
        <CardDescription>{t(`${copy}.description`)}</CardDescription>
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
            <Controller
              control={form.control}
              name="email"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid || undefined}>
                  <FieldLabel htmlFor="email">{t("email")}</FieldLabel>
                  <Input
                    {...field}
                    id="email"
                    type="email"
                    autoComplete="email"
                    placeholder={t("emailPlaceholder")}
                    aria-invalid={fieldState.invalid}
                  />
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name="password"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid || undefined}>
                  <FieldLabel htmlFor="password">{t("password")}</FieldLabel>
                  <Input
                    {...field}
                    id="password"
                    type="password"
                    autoComplete={
                      mode === "login" ? "current-password" : "new-password"
                    }
                    aria-invalid={fieldState.invalid}
                  />
                  {mode === "signup" && !fieldState.invalid ? (
                    <FieldDescription>{t("passwordHint")}</FieldDescription>
                  ) : null}
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
            <Field>
              <Button type="submit" size="lg" disabled={pending}>
                {pending ? <Spinner data-icon="inline-start" /> : null}
                {t(`${copy}.submit`)}
              </Button>
            </Field>
            <FieldSeparator>{t("or")}</FieldSeparator>
            <Field>
              <Button
                type="button"
                variant="outline"
                size="lg"
                disabled={googlePending}
                onClick={() => {
                  setServerError(undefined)
                  startGoogle(async () =>
                    handleResult(await signInWithGoogle(next))
                  )
                }}
              >
                {googlePending ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <GoogleIcon />
                )}
                {t("google")}
              </Button>
              <FieldDescription>{t("googleHint")}</FieldDescription>
            </Field>
          </FieldGroup>
        </form>
      </CardContent>
      <CardFooter className="justify-center gap-1 text-muted-foreground">
        {mode === "login" ? t("login.noAccount") : t("signup.hasAccount")}
        <Link
          href={mode === "login" ? "/cadastro" : "/entrar"}
          className={buttonVariants({ variant: "link", className: "px-1" })}
        >
          {mode === "login" ? t("login.signUpLink") : t("signup.signInLink")}
        </Link>
      </CardFooter>
    </Card>
  )
}
