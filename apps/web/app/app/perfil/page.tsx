import { getTranslations } from "next-intl/server"

import { NotConfigured } from "@/components/app/not-configured"
import {
  AddressForm,
  ContactForm,
  DocumentsForm,
  PreferencesForm,
  SituationForm,
} from "@/components/profile/profile-forms"
import {
  BlocklistEditor,
  EducationsEditor,
  ExperiencesEditor,
  LanguagesEditor,
  SalaryRulesEditor,
  StandardAnswersEditor,
} from "@/components/profile/list-editors"
import {
  DiversitySection,
  SkillsEditor,
} from "@/components/profile/skills-diversity"
import { ProfileTabs } from "@/components/profile/profile-tabs"
import { loadProfileBundle } from "@/lib/profile/server"
import { getUserContext } from "@/lib/server/context"

const SECTIONS = [
  "contato",
  "trajetoria",
  "idiomas",
  "preferencias",
  "respostas",
  "bloqueadas",
  "diversidade",
] as const

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const t = await getTranslations("ProfilePage")
  const context = await getUserContext()
  if (!context.ok) return <NotConfigured title={t("title")} />

  const bundle = await loadProfileBundle(context.ctx)
  const { profile } = bundle
  const requested = (await searchParams).secao
  const section = SECTIONS.find((value) => value === requested) ?? "contato"
  const situation = profile.preferences.situation

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-bold tracking-tight">{t("title")}</h2>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </div>
      <ProfileTabs
        defaultValue={section}
        tabs={SECTIONS.map((value) => ({ value, label: t(`tabs.${value}`) }))}
        panels={{
          contato: (
            <>
              <ContactForm
                profileUserId={context.ctx.user.id}
                defaults={{
                  displayName: profile.displayName,
                  firstName: profile.firstName,
                  lastName: profile.lastName,
                  emailContact: profile.emailContact,
                  phone: profile.phone,
                  birthDate: profile.birthDate,
                  city: profile.city,
                  state: profile.state,
                  linkedinUrl: profile.linkedinUrl,
                  portfolioUrl: profile.portfolioUrl,
                  cvFilenamePattern: profile.cvFilenamePattern,
                }}
              />
              <DocumentsForm defaults={profile.documents} />
              <AddressForm defaults={profile.address} />
              <SituationForm
                defaults={{
                  situation: situation?.situation ?? "empregado",
                  currentCompany: situation?.currentCompany ?? "",
                  currentPayMode:
                    situation?.currentPayMode ?? "prefiro_nao_informar",
                  currentPay:
                    situation?.currentPayMode === "informar"
                      ? (bundle.answers.find(
                          (a) => a.key === "remuneracao_atual"
                        )?.answer ?? "")
                      : "",
                }}
              />
            </>
          ),
          trajetoria: (
            <>
              <ExperiencesEditor items={bundle.experiences} />
              <EducationsEditor items={bundle.educations} />
            </>
          ),
          idiomas: (
            <>
              <LanguagesEditor items={bundle.languages} />
              <SkillsEditor items={bundle.skills} />
            </>
          ),
          preferencias: (
            <>
              <PreferencesForm
                defaults={{
                  workModels: profile.preferences.workModels ?? [],
                  regimes: profile.preferences.regimes ?? [],
                  cities: (profile.preferences.cities ?? []).join(", "),
                  availability: profile.preferences.availability ?? "30_dias",
                  travel: profile.preferences.travel ?? "a_combinar",
                  relocation: profile.preferences.relocation ?? "a_combinar",
                }}
              />
              <SalaryRulesEditor items={bundle.salaryRules} />
            </>
          ),
          respostas: (
            <StandardAnswersEditor
              items={bundle.answers.filter(
                (a) => a.key !== "remuneracao_atual"
              )}
            />
          ),
          bloqueadas: <BlocklistEditor items={bundle.blocklist} />,
          diversidade: (
            <DiversitySection
              consent={bundle.diversityConsent}
              defaults={bundle.diversity}
            />
          ),
        }}
      />
    </section>
  )
}
