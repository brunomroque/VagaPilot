import "server-only"

import type { UserContext } from "@/lib/server/context"

import type { ProfilePreferences } from "./schemas"

/**
 * `get_profile_summary` (10.2/10.3) building block: what the agent may know about the user.
 * Never includes `_enc` data (phone, address, documents, birth date, diversity), the current
 * pay or sensitive standard answers (10.4: sensitive data does not go to the LLM).
 */
export type ProfileSummary = {
  name: { first: string | null; last: string | null; display: string }
  location: {
    city: string | null
    state: string | null
    country: string | null
  }
  links: { linkedin: string | null; portfolio: string | null }
  preferences: Omit<ProfilePreferences, "onboarding" | "situation"> & {
    situation?: "empregado" | "nao_empregado"
  }
  experiences: {
    id: string
    company: string
    title: string
    employmentType: string
    start: string
    end: string | null
    isCurrent: boolean
  }[]
  educations: {
    level: string | null
    degree: string | null
    field: string | null
    status: string | null
  }[]
  languages: { language: string; level: string; cefr: string | null }[]
  salaryRules: {
    seniority: string
    regime: string
    min: number | null
    target: number
    currency: string
    period: string
  }[]
  standardAnswerKeys: string[]
  cvTracks: { id: string; name: string; keywords: string[] }[]
}

export async function getProfileSummary(
  ctx: UserContext
): Promise<ProfileSummary> {
  const userId = ctx.user.id
  const [profile, experiences, educations, languages, salary, answers, tracks] =
    await Promise.all([
      ctx.supabase
        .from("candidate_profiles")
        .select(
          "display_name, first_name, last_name, city, state, country, linkedin_url, portfolio_url, preferences"
        )
        .eq("user_id", userId)
        .maybeSingle(),
      ctx.supabase
        .from("experiences")
        .select(
          "id, company, title, employment_type, start_date, end_date, is_current"
        )
        .eq("user_id", userId)
        .order("start_date", { ascending: false }),
      ctx.supabase
        .from("educations")
        .select("level, degree, field, status")
        .eq("user_id", userId),
      ctx.supabase
        .from("languages")
        .select("language, level, cefr")
        .eq("user_id", userId),
      ctx.supabase
        .from("salary_rules")
        .select(
          "seniority, regime, amount_min, amount_target, currency, period"
        )
        .eq("user_id", userId),
      ctx.supabase
        .from("standard_answers")
        .select("key")
        .eq("user_id", userId)
        .eq("is_sensitive", false),
      ctx.supabase
        .from("cv_tracks")
        .select("id, name, keywords")
        .eq("user_id", userId),
    ])
  for (const result of [
    profile,
    experiences,
    educations,
    languages,
    salary,
    answers,
    tracks,
  ]) {
    if (result.error) throw new Error(result.error.message)
  }

  const row = profile.data as {
    display_name: string
    first_name: string | null
    last_name: string | null
    city: string | null
    state: string | null
    country: string | null
    linkedin_url: string | null
    portfolio_url: string | null
    preferences: ProfilePreferences | null
  } | null
  const {
    onboarding: _onboarding,
    situation,
    ...preferences
  } = row?.preferences ?? {}

  return {
    name: {
      first: row?.first_name ?? null,
      last: row?.last_name ?? null,
      display: row?.display_name ?? ctx.user.displayName,
    },
    location: {
      city: row?.city ?? null,
      state: row?.state ?? null,
      country: row?.country ?? null,
    },
    links: {
      linkedin: row?.linkedin_url ?? null,
      portfolio: row?.portfolio_url ?? null,
    },
    preferences: { ...preferences, situation: situation?.situation },
    experiences: (
      (experiences.data ?? []) as {
        id: string
        company: string
        title: string
        employment_type: string
        start_date: string
        end_date: string | null
        is_current: boolean | null
      }[]
    ).map((item) => ({
      id: item.id,
      company: item.company,
      title: item.title,
      employmentType: item.employment_type,
      start: item.start_date,
      end: item.end_date,
      isCurrent: item.is_current === true,
    })),
    educations: (educations.data ?? []) as ProfileSummary["educations"],
    languages: (languages.data ?? []) as ProfileSummary["languages"],
    salaryRules: (
      (salary.data ?? []) as {
        seniority: string
        regime: string
        amount_min: number | null
        amount_target: number
        currency: string | null
        period: string | null
      }[]
    ).map((item) => ({
      seniority: item.seniority,
      regime: item.regime,
      min: item.amount_min === null ? null : Number(item.amount_min),
      target: Number(item.amount_target),
      currency: item.currency ?? "BRL",
      period: item.period ?? "mensal",
    })),
    standardAnswerKeys: ((answers.data ?? []) as { key: string }[]).map(
      (item) => item.key
    ),
    cvTracks: (
      (tracks.data ?? []) as {
        id: string
        name: string
        keywords: string[] | null
      }[]
    ).map((item) => ({
      id: item.id,
      name: item.name,
      keywords: item.keywords ?? [],
    })),
  }
}
