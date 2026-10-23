import type { ReactNode } from "react"
import Link from "next/link"
import {
  CheckCircle2Icon,
  CircleIcon,
  MailIcon,
  PuzzleIcon,
} from "lucide-react"
import { getTranslations } from "next-intl/server"

import { NotConfigured } from "@/components/app/not-configured"
import { CvLibrary } from "@/components/cvs/cv-library"
import { CvUpload } from "@/components/cvs/cv-upload"
import { FactReview } from "@/components/facts/fact-review"
import { WizardShell } from "@/components/onboarding/wizard-shell"
import {
  BlocklistEditor,
  LanguagesEditor,
  SalaryRulesEditor,
} from "@/components/profile/list-editors"
import {
  PreferencesForm,
  SituationForm,
} from "@/components/profile/profile-forms"
import { loadCvLibrary } from "@/lib/cvs/server"
import { loadFactReview } from "@/lib/facts/server"
import {
  answersComplete,
  loadOnboardingState,
  ONBOARDING_STEPS,
  type OnboardingRequirements,
} from "@/lib/onboarding/server"
import { loadProfileBundle } from "@/lib/profile/server"
import { getUserContext } from "@/lib/server/context"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@workspace/ui/components/empty"

type RequirementKey = keyof OnboardingRequirements

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const t = await getTranslations("Onboarding")
  const context = await getUserContext()
  if (!context.ok) return <NotConfigured title={t("title")} />
  const ctx = context.ctx

  const state = await loadOnboardingState(ctx)
  const requested = Number((await searchParams).etapa)
  const step =
    Number.isInteger(requested) &&
    requested >= 1 &&
    requested <= ONBOARDING_STEPS.length
      ? requested
      : state.savedStep
  const key = ONBOARDING_STEPS[step - 1] ?? "cvs"
  const requirements = state.requirements

  const missing = (Object.keys(requirements) as RequirementKey[])
    .filter((name) => !requirements[name])
    .map((name) => t(`requirements.${name}`))

  let canAdvance = true
  let blockedReason: string | undefined
  if (key === "cvs" && !requirements.hasCv) {
    canAdvance = false
    blockedReason = t("blocked.cvs")
  }
  if (key === "respostas" && !answersComplete(requirements)) {
    canAdvance = false
    blockedReason = t("blocked.respostas")
  }

  let content: ReactNode = null
  switch (key) {
    case "cvs": {
      const library = await loadCvLibrary(ctx)
      content = (
        <>
          <CvUpload tracks={library.tracks} />
          {library.versions.length > 0 ? (
            <ul
              className="flex flex-col divide-y rounded-lg border"
              aria-label={t("cvs.uploaded")}
            >
              {library.versions.map((version) => (
                <li
                  key={version.id}
                  className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
                >
                  <span className="min-w-0 truncate font-medium">
                    {version.label}
                  </span>
                  <span className="flex gap-2">
                    <Badge variant="outline">{version.language}</Badge>
                    {version.processing === "falhou" ? (
                      <span className="text-sm text-destructive">
                        {t(
                          `cvs.extraction.${version.extractionError ?? "unreadable"}`
                        )}
                      </span>
                    ) : version.processing === "pendente" ? (
                      <Badge variant="secondary">{t("cvs.processing")}</Badge>
                    ) : (
                      <Badge variant="secondary">
                        {t("cvs.facts", { count: version.proposedFacts })}
                      </Badge>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )
      break
    }
    case "fatos": {
      const review = await loadFactReview(ctx, "proposto")
      if (review.groups.length > 0) {
        content = <FactReview groups={review.groups} status="proposto" />
        break
      }
      const library = await loadCvLibrary(ctx)
      const failed = library.versions.find(
        (version) => version.processing === "falhou"
      )
      const pending = library.versions.some(
        (version) => version.processing === "pendente"
      )
      content = (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>
              {failed
                ? t("facts.unreadableTitle")
                : pending
                  ? t("facts.pendingTitle")
                  : t("facts.emptyTitle")}
            </EmptyTitle>
            <EmptyDescription>
              {failed
                ? t(`cvs.extraction.${failed.extractionError ?? "unreadable"}`)
                : pending
                  ? t("facts.pendingDescription")
                  : t("facts.emptyDescription")}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )
      break
    }
    case "trilhas": {
      const library = await loadCvLibrary(ctx)
      content = (
        <CvLibrary tracks={library.tracks} versions={library.versions} />
      )
      break
    }
    case "respostas": {
      const bundle = await loadProfileBundle(ctx)
      const preferences = bundle.profile.preferences
      const situation = preferences.situation
      const checklist: RequirementKey[] = [
        "hasSalaryRule",
        "hasWorkModels",
        "hasRegimes",
        "hasAvailability",
        "hasLanguage",
      ]
      content = (
        <>
          <ul className="grid gap-2 sm:grid-cols-2" aria-label={t("checklist")}>
            {checklist.map((name) => (
              <li key={name} className="flex items-center gap-2 text-sm">
                {requirements[name] ? (
                  <CheckCircle2Icon
                    className="size-4 text-primary"
                    aria-hidden
                  />
                ) : (
                  <CircleIcon
                    className="size-4 text-muted-foreground"
                    aria-hidden
                  />
                )}
                <span>
                  {t(`requirements.${name}`)}
                  <span className="sr-only">
                    {requirements[name] ? t("done") : t("pending")}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <PreferencesForm
            defaults={{
              workModels: preferences.workModels ?? [],
              regimes: preferences.regimes ?? [],
              cities: (preferences.cities ?? []).join(", "),
              availability: preferences.availability ?? "30_dias",
              travel: preferences.travel ?? "a_combinar",
              relocation: preferences.relocation ?? "a_combinar",
            }}
          />
          <SalaryRulesEditor items={bundle.salaryRules} />
          <LanguagesEditor items={bundle.languages} />
          <SituationForm
            defaults={{
              situation: situation?.situation ?? "empregado",
              currentCompany: situation?.currentCompany ?? "",
              currentPayMode:
                situation?.currentPayMode ?? "prefiro_nao_informar",
              currentPay: "",
            }}
          />
        </>
      )
      break
    }
    case "bloqueadas": {
      const bundle = await loadProfileBundle(ctx)
      content = <BlocklistEditor items={bundle.blocklist} />
      break
    }
    case "convites":
      content = (
        <div className="grid gap-4 md:grid-cols-2">
          {(
            [
              ["gmail", MailIcon],
              ["extension", PuzzleIcon],
            ] as const
          ).map(([name, Icon]) => (
            <Card key={name}>
              <CardHeader>
                <span className="flex size-10 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
                  <Icon className="size-5" aria-hidden />
                </span>
                <CardTitle>
                  <h4 className="font-bold">{t(`invites.${name}.title`)}</h4>
                </CardTitle>
                <CardDescription>
                  {t(`invites.${name}.description`)}
                </CardDescription>
              </CardHeader>
              <CardFooter className="flex flex-wrap items-center gap-2">
                <Button variant="outline" disabled>
                  {t(`invites.${name}.action`)}
                </Button>
                <Badge variant="outline">{t("invites.soon")}</Badge>
              </CardFooter>
            </Card>
          ))}
        </div>
      )
      break
    default: {
      const unreachable: never = key
      throw new Error(`Unhandled onboarding step: ${String(unreachable)}`)
    }
  }

  return (
    <>
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>{t("chatOption.title")}</CardTitle>
          <CardDescription>{t("chatOption.description")}</CardDescription>
        </CardHeader>
        <CardFooter>
          <Button render={<Link href="/app" />}>
            {t("chatOption.action")}
          </Button>
        </CardFooter>
      </Card>
      <WizardShell
        step={step}
        steps={ONBOARDING_STEPS.map((name) => t(`steps.${name}.label`))}
        title={t(`steps.${key}.title`)}
        description={t(`steps.${key}.description`)}
        canAdvance={canAdvance}
        blockedReason={blockedReason}
        missing={missing}
      >
        {content}
      </WizardShell>
    </>
  )
}
