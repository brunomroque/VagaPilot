"use client"

import { useTranslations } from "next-intl"

import type { Option } from "@/components/forms/fields"
import {
  ACCEPTED_REGIMES,
  AVAILABILITY,
  CEFR_LEVELS,
  CURRENCIES,
  CURRENT_PAY_MODES,
  CV_LANGUAGE_OPTIONS,
  EDUCATION_LEVELS,
  EDUCATION_STATUSES,
  EMPLOYMENT_SITUATIONS,
  EMPLOYMENT_TYPES,
  GENDERS,
  LANGUAGE_LEVELS,
  ORIENTATIONS,
  PCD_OPTIONS,
  RACES,
  SALARY_PERIODS,
  SENIORITIES,
  WORK_MODELS,
  YES_NO_MAYBE,
} from "@/lib/profile/schemas"

/** Localized option lists for every enum used in profile forms. */
export function useProfileOptions() {
  const t = useTranslations("ProfileOptions")
  const map = <V extends string>(
    values: readonly V[],
    label: (value: V) => string
  ): Option[] => values.map((value) => ({ value, label: label(value) }))

  return {
    employmentTypes: map(EMPLOYMENT_TYPES, (v) => t(`employmentType.${v}`)),
    seniorities: map(SENIORITIES, (v) => t(`seniority.${v}`)),
    workModels: map(WORK_MODELS, (v) => t(`workModel.${v}`)),
    regimes: map(ACCEPTED_REGIMES, (v) => t(`regime.${v}`)),
    languageLevels: map(LANGUAGE_LEVELS, (v) => t(`languageLevel.${v}`)),
    cefr: [{ value: "", label: t("cefrNone") }, ...map(CEFR_LEVELS, (v) => v)],
    educationLevels: map(EDUCATION_LEVELS, (v) => t(`educationLevel.${v}`)),
    educationStatuses: map(EDUCATION_STATUSES, (v) =>
      t(`educationStatus.${v}`)
    ),
    currencies: map(CURRENCIES, (v) => v),
    periods: map(SALARY_PERIODS, (v) => t(`period.${v}`)),
    availability: map(AVAILABILITY, (v) => t(`availability.${v}`)),
    yesNoMaybe: map(YES_NO_MAYBE, (v) => t(`yesNoMaybe.${v}`)),
    situations: map(EMPLOYMENT_SITUATIONS, (v) => t(`situation.${v}`)),
    payModes: map(CURRENT_PAY_MODES, (v) => t(`payMode.${v}`)),
    cvLanguages: map(CV_LANGUAGE_OPTIONS, (v) => t(`cvLanguage.${v}`)),
    genders: map(GENDERS, (v) => t(`gender.${v}`)),
    orientations: map(ORIENTATIONS, (v) => t(`orientation.${v}`)),
    races: map(RACES, (v) => t(`race.${v}`)),
    pcd: map(PCD_OPTIONS, (v) => t(`pcd.${v}`)),
  }
}

export type ProfileOptions = ReturnType<typeof useProfileOptions>

export function labelOf(
  options: readonly Option[],
  value: string | null | undefined
) {
  return options.find((option) => option.value === value)?.label ?? value ?? ""
}
