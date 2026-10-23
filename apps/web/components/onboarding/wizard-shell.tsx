"use client"

import { useTransition, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  CircleAlertIcon,
  MessageSquareTextIcon,
} from "lucide-react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"

import {
  completeOnboarding,
  saveOnboardingStep,
} from "@/app/app/onboarding/actions"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Progress } from "@workspace/ui/components/progress"
import { Spinner } from "@workspace/ui/components/spinner"

export function WizardShell({
  step,
  steps,
  title,
  description,
  canAdvance,
  blockedReason,
  missing,
  children,
}: {
  step: number
  steps: string[]
  title: string
  description: string
  canAdvance: boolean
  blockedReason?: string
  missing: string[]
  children: ReactNode
}) {
  const t = useTranslations("Onboarding")
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const total = steps.length
  const isLast = step === total

  function go(target: number) {
    startTransition(async () => {
      const result = await saveOnboardingStep(target)
      if (!result.ok) {
        toast.error(t("saveError"))
        return
      }
      router.push(`/app/onboarding?etapa=${target}`)
      router.refresh()
    })
  }

  function later() {
    startTransition(async () => {
      await saveOnboardingStep(step)
      toast.success(t("savedForLater"))
      router.push("/app/chat")
    })
  }

  function finish() {
    startTransition(async () => {
      const result = await completeOnboarding()
      if (!result.ok) {
        toast.error(t("cannotFinish"))
        return
      }
      toast.success(t("finished"))
      router.push("/app/chat")
    })
  }

  return (
    <section className="flex flex-col gap-4" aria-labelledby="onboarding-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2
            id="onboarding-title"
            className="text-xl font-bold tracking-tight"
          >
            {t("title")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <Button variant="ghost" onClick={later} disabled={pending}>
          <MessageSquareTextIcon data-icon="inline-start" />
          {t("later")}
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between text-sm font-medium">
          <span>{t("stepOf", { step, total })}</span>
          <span className="text-muted-foreground">
            {Math.round((step / total) * 100)}%
          </span>
        </div>
        <Progress
          value={(step / total) * 100}
          aria-label={t("progress", { step, total })}
        />
        <ol className="hidden flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground md:flex">
          {steps.map((label, index) => (
            <li
              key={label}
              aria-current={index + 1 === step ? "step" : undefined}
              className={
                index + 1 === step ? "font-semibold text-foreground" : undefined
              }
            >
              {index + 1}. {label}
            </li>
          ))}
        </ol>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            <h3 className="text-lg font-bold">{title}</h3>
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">{children}</CardContent>
      </Card>

      {!canAdvance && blockedReason ? (
        <Alert>
          <CircleAlertIcon />
          <AlertTitle>{t("blockedTitle")}</AlertTitle>
          <AlertDescription>{blockedReason}</AlertDescription>
        </Alert>
      ) : null}
      {isLast && missing.length > 0 ? (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>{t("missingTitle")}</AlertTitle>
          <AlertDescription>
            <ul className="ml-4 list-disc">
              {missing.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      <nav
        aria-label={t("navLabel")}
        className="flex flex-wrap items-center justify-between gap-2"
      >
        <Button
          variant="outline"
          onClick={() => go(step - 1)}
          disabled={pending || step === 1}
        >
          <ArrowLeftIcon data-icon="inline-start" />
          {t("back")}
        </Button>
        {isLast ? (
          <Button onClick={finish} disabled={pending || missing.length > 0}>
            {pending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <CheckIcon data-icon="inline-start" />
            )}
            {t("finish")}
          </Button>
        ) : (
          <Button
            onClick={() => go(step + 1)}
            disabled={pending || !canAdvance}
          >
            {pending ? <Spinner data-icon="inline-start" /> : null}
            {step === 2 ? t("skipOrContinue") : t("next")}
            <ArrowRightIcon data-icon="inline-end" />
          </Button>
        )}
      </nav>
    </section>
  )
}
