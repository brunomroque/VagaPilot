import type { SupabaseClient } from "@supabase/supabase-js"
import { canonicalizeUrl } from "@vagapilot/ats-adapters"
import {
  assessFit,
  type Embedder,
  type FitFact,
  type FitResult,
} from "@vagapilot/ai"
import {
  matchBlocklist,
  normalizeCompanyName,
  type BlocklistEntry,
} from "@vagapilot/core/blocklist"
import { normalizeForGrounding } from "@vagapilot/core/facts"
import {
  checkDuplicateInTracker,
  computeJobAlerts,
  isSeniority,
  mergeDuplicateWithGmail,
  recommendCv,
  suggestSalary,
  titleSimilarity,
  type JobAlert,
  type JobLanguage,
  type LanguageLevel,
  type Regime,
  type SalaryRule,
  type Seniority,
  type WorkModel,
} from "@vagapilot/core/job-rules"
import {
  searchGmailForDuplicates,
  type GmailDuplicateResult,
} from "@vagapilot/gmail"
import type { ApplicationStatus } from "@vagapilot/core/status"
import { searchConfirmedFacts } from "@vagapilot/db/server"

/** Posting fields the match needs (from `job_postings`). */
export type PostingForMatch = {
  id: string
  canonical_url: string
  company: string | null
  company_domain: string | null
  title: string
  seniority: Seniority | null
  location: string | null
  work_model: WorkModel | null
  regime: Regime | null
  language: string | null
  requirements_required: string[] | null
  requirements_preferred: string[] | null
  languages_required: { language: string; level: LanguageLevel }[] | null
  salary_min: number | string | null
  salary_max: number | string | null
  salary_currency: string | null
  apply_url: string | null
}

export const POSTING_COLUMNS =
  "id, canonical_url, company, company_domain, title, seniority, location, work_model, regime, language, requirements_required, requirements_preferred, languages_required, salary_min, salary_max, salary_currency, apply_url"

export type MatchDeps = {
  /** service_role: every query below filters by user_id explicitly. */
  admin: SupabaseClient
  embedder: Embedder
  assess?: typeof assessFit
  /** P6.3: cost ceiling before assessFit LLM call. */
  assessBillable?: () => Promise<void>
  now?: () => Date
  /** RF5.2 Gmail duplicate search (defaults to `@vagapilot/gmail`; tests inject a stub). */
  searchGmailDuplicates?: typeof searchGmailForDuplicates
}

type ProfilePreferences = {
  workModels?: WorkModel[]
  regimes?: ("clt" | "pj")[]
  cities?: string[]
  relocation?: "sim" | "nao" | "a_combinar"
}

type UserContextRows = {
  profile: {
    city: string | null
    preferences: ProfilePreferences | null
  } | null
  languages: { language: string; level: string; cefr: string | null }[]
  salaryRules: SalaryRule[]
  blocklist: (BlocklistEntry & { source: "blocklist" | "excluded" })[]
  applications: {
    id: string
    link: string | null
    company: string
    role_title: string
    status: ApplicationStatus
    applied_at: string | null
    created_at: string
  }[]
  versions: {
    id: string
    track_id: string | null
    language: string
    is_default: boolean | null
    fact_ids: string[] | null
  }[]
  tracks: { id: string; name: string; keywords: string[] | null }[]
}

function rows<T>(
  result: { data: unknown; error: { message: string } | null },
  label: string
): T[] {
  if (result.error) throw new Error(`${label}: ${result.error.message}`)
  return (result.data ?? []) as T[]
}

export async function loadUserContext(
  admin: SupabaseClient,
  userId: string
): Promise<UserContextRows> {
  const [
    profile,
    languages,
    salary,
    blocklist,
    excluded,
    applications,
    versions,
    tracks,
  ] = await Promise.all([
    admin
      .from("candidate_profiles")
      .select("city, preferences")
      .eq("user_id", userId)
      .maybeSingle(),
    admin
      .from("languages")
      .select("language, level, cefr")
      .eq("user_id", userId),
    admin
      .from("salary_rules")
      .select("seniority, regime, amount_min, amount_target, currency, period")
      .eq("user_id", userId),
    admin
      .from("company_blocklist")
      .select("id, company_name, normalized_name, aliases, domains")
      .eq("user_id", userId),
    admin
      .from("excluded_companies")
      .select("id, company_name, normalized_name")
      .eq("user_id", userId),
    admin
      .from("applications")
      .select("id, link, company, role_title, status, applied_at, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1000),
    admin
      .from("cv_versions")
      .select("id, track_id, language, is_default, fact_ids")
      .eq("user_id", userId),
    admin.from("cv_tracks").select("id, name, keywords").eq("user_id", userId),
  ])
  if (profile.error)
    throw new Error(`candidate_profiles: ${profile.error.message}`)
  return {
    profile: profile.data as UserContextRows["profile"],
    languages: rows(languages, "languages"),
    salaryRules: rows<{
      seniority: Seniority
      regime: Regime
      amount_min: number | string | null
      amount_target: number | string
      currency: string | null
      period: string | null
    }>(salary, "salary_rules").map((rule) => ({
      seniority: rule.seniority,
      regime: rule.regime,
      min: rule.amount_min === null ? null : Number(rule.amount_min),
      target: Number(rule.amount_target),
      currency: rule.currency ?? "BRL",
      period: rule.period ?? "mensal",
    })),
    blocklist: [
      ...rows<{
        id: string
        company_name: string
        normalized_name: string
        aliases: string[] | null
        domains: string[] | null
      }>(blocklist, "company_blocklist").map((entry) => ({
        id: entry.id,
        companyName: entry.company_name,
        normalizedName: entry.normalized_name,
        aliases: entry.aliases ?? [],
        domains: entry.domains ?? [],
        source: "blocklist" as const,
      })),
      ...rows<{ id: string; company_name: string; normalized_name: string }>(
        excluded,
        "excluded_companies"
      ).map((entry) => ({
        id: entry.id,
        companyName: entry.company_name,
        normalizedName: entry.normalized_name,
        source: "excluded" as const,
      })),
    ],
    applications: rows(applications, "applications"),
    versions: rows(versions, "cv_versions"),
    tracks: rows(tracks, "cv_tracks"),
  }
}

function toNumber(value: number | string | null): number | null {
  if (value === null || value === "") return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function hostOf(url: string | null): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

function tokens(text: string): Set<string> {
  return new Set(
    normalizeForGrounding(text)
      .split(/[^a-z0-9+#]+/)
      .filter((token) => token.length >= 3)
  )
}

function overlap(requirements: Set<string>, text: string): number {
  if (requirements.size === 0) return 0
  let shared = 0
  for (const token of tokens(text)) if (requirements.has(token)) shared += 1
  return shared / requirements.size
}

const MAX_REQUIREMENTS_SEARCHED = 12
const FACTS_PER_REQUIREMENT = 3

/** Confirmed facts closest to each requirement (search_facts, 10.2): never proposed ones. */
async function factsForRequirements(
  deps: MatchDeps,
  userId: string,
  requirements: string[]
): Promise<FitFact[]> {
  const wanted = requirements.slice(0, MAX_REQUIREMENTS_SEARCHED)
  if (wanted.length === 0) return []
  const embeddings = await deps.embedder.embedMany(wanted)
  const found = new Map<string, FitFact>()
  for (const embedding of embeddings) {
    for (const fact of await searchConfirmedFacts(
      deps.admin,
      userId,
      embedding,
      FACTS_PER_REQUIREMENT
    )) {
      found.set(fact.id, {
        id: fact.id,
        statement: fact.statement,
        kind: fact.kind,
        tags: fact.tags,
      })
    }
  }
  return [...found.values()]
}

export type MatchOutcome = {
  matchId: string
  blocked: boolean
  fit: string | null
}

/**
 * Per-user analysis of one posting (F5, F6, P2.2/P2.3): blocklist → duplicate → code alerts
 * → salary rule → confirmed facts → assessFit → CV recommendation, upserted in job_matches.
 * The user's decision columns are never overwritten.
 */
export async function computeMatch(
  deps: MatchDeps,
  userId: string,
  posting: PostingForMatch,
  options: {
    force?: boolean
    extractModel?: string
    extractPromptVersion?: string
  } = {}
): Promise<MatchOutcome> {
  const context = await loadUserContext(deps.admin, userId)
  const now = deps.now?.() ?? new Date()

  const blocked = options.force
    ? null
    : matchBlocklist(context.blocklist, {
        company: posting.company,
        domain: posting.company_domain ?? hostOf(posting.apply_url),
      })

  const trackedApplications = context.applications.map((application) => ({
    id: application.id,
    canonicalLink: application.link ? canonicalizeUrl(application.link) : null,
    company: application.company,
    roleTitle: application.role_title,
    status: application.status,
    appliedAt: application.applied_at,
    createdAt: application.created_at,
  }))
  const trackerDuplicate = checkDuplicateInTracker(
    {
      canonicalUrl: posting.canonical_url,
      company: posting.company,
      title: posting.title,
    },
    trackedApplications,
    now
  )
  const companyNorm = posting.company
    ? normalizeCompanyName(posting.company)
    : ""
  const relatedMatch =
    companyNorm.length > 0
      ? (trackedApplications
          .map((application) => ({
            application,
            similarity: titleSimilarity(posting.title, application.roleTitle),
          }))
          .filter(
            (row) =>
              normalizeCompanyName(row.application.company) === companyNorm
          )
          .sort((a, b) => b.similarity - a.similarity)[0] ?? null)
      : null
  const relatedApplication = relatedMatch?.application ?? null
  const gmailDomains = [
    posting.company_domain,
    hostOf(posting.apply_url),
  ].filter((value): value is string => Boolean(value))
  const searchGmail = deps.searchGmailDuplicates ?? searchGmailForDuplicates
  let gmailSearch: GmailDuplicateResult = { status: "not_connected" }
  if (posting.company) {
    try {
      gmailSearch = await searchGmail(
        userId,
        {
          company: posting.company,
          role: posting.title,
          domains: gmailDomains,
        },
        { budgetMs: 4_500 }
      )
    } catch {
      gmailSearch = { status: "not_connected" }
    }
  }
  const gmailInput =
    gmailSearch.status === "not_connected"
      ? gmailSearch
      : {
          status: gmailSearch.status,
          matches: gmailSearch.matches.map((match) => ({
            subject: match.subject,
            receivedAt: match.receivedAt,
          })),
        }
  const duplicate = mergeDuplicateWithGmail(
    trackerDuplicate,
    gmailInput,
    relatedApplication,
    relatedMatch?.similarity ?? 0
  )

  const base = {
    user_id: userId,
    job_posting_id: posting.id,
    duplicate_check: duplicate,
  }

  if (blocked) {
    const { data, error } = await deps.admin
      .from("job_matches")
      .upsert(
        {
          ...base,
          blocked: true,
          fit: null,
          fit_score: null,
          reasons: [],
          gaps: [],
          alerts: [],
          suggested_salary: null,
          recommended_cv_version_id: null,
          model_version: null,
          prompt_version: null,
        },
        { onConflict: "user_id,job_posting_id" }
      )
      .select("id")
      .single()
    if (error || !data)
      throw new Error(`job_matches upsert failed: ${error?.message}`)
    return {
      matchId: String((data as { id: string }).id),
      blocked: true,
      fit: null,
    }
  }

  const preferences = context.profile?.preferences ?? {}
  const seniority = isSeniority(posting.seniority) ? posting.seniority : null
  const codeAlerts: JobAlert[] = computeJobAlerts(
    {
      seniority,
      workModel: posting.work_model,
      regime: posting.regime,
      location: posting.location,
      languagesRequired: posting.languages_required ?? [],
    },
    {
      languages: context.languages,
      workModels: preferences.workModels ?? [],
      regimes: preferences.regimes ?? [],
      cities: preferences.cities ?? [],
      homeCity: context.profile?.city ?? null,
      relocation: preferences.relocation ?? null,
      targetSeniorities: [
        ...new Set(context.salaryRules.map((rule) => rule.seniority)),
      ],
    }
  )
  const salary = suggestSalary(context.salaryRules, {
    seniority,
    regime: posting.regime,
    jobRange: {
      min: toNumber(posting.salary_min),
      max: toNumber(posting.salary_max),
      currency: posting.salary_currency,
    },
  })
  const alerts =
    salary.status === "rule" && salary.alert
      ? [...codeAlerts, salary.alert]
      : codeAlerts

  const requirementsRequired = posting.requirements_required ?? []
  const requirementsPreferred = posting.requirements_preferred ?? []
  const facts = await factsForRequirements(deps, userId, [
    ...requirementsRequired,
    ...requirementsPreferred,
  ])
  const language = (
    ["pt-BR", "en", "es"].includes(posting.language ?? "")
      ? posting.language
      : "pt-BR"
  ) as JobLanguage
  const fit: FitResult = await (deps.assess ?? assessFit)(
    {
      job: {
        title: posting.title,
        company: posting.company,
        requirementsRequired,
        requirementsPreferred,
        language,
      },
      facts,
      codeAlerts: alerts,
      tracks: context.tracks.map((track) => ({
        id: track.id,
        name: track.name,
        keywords: track.keywords ?? [],
      })),
    },
    { assertBillable: deps.assessBillable }
  )

  const requirementTokens = tokens(
    [...requirementsRequired, ...requirementsPreferred, posting.title].join(" ")
  )
  const factById = new Map(facts.map((fact) => [fact.id, fact]))
  const trackScores = context.tracks.map((track) => {
    const trackFacts = context.versions
      .filter((version) => version.track_id === track.id)
      .flatMap((version) => version.fact_ids ?? [])
      .map((id) => factById.get(id)?.statement ?? "")
      .join(" ")
    const similarity =
      overlap(
        requirementTokens,
        `${track.name} ${(track.keywords ?? []).join(" ")} ${trackFacts}`
      ) + (fit.assessment.recommendedTrackId === track.id ? 0.25 : 0)
    return { trackId: track.id, similarity }
  })
  const cv = recommendCv({
    jobLanguage: language,
    trackScores,
    versions: context.versions.map((version) => ({
      id: version.id,
      trackId: version.track_id,
      language: version.language,
      isDefault: version.is_default === true,
    })),
  })

  const alertParams = new Map(alerts.map((alert) => [alert.code, alert.params]))
  const { data, error } = await deps.admin
    .from("job_matches")
    .upsert(
      {
        ...base,
        blocked: false,
        fit: fit.assessment.fit,
        fit_score: fit.assessment.score,
        reasons: fit.assessment.reasons,
        gaps: fit.assessment.gaps,
        alerts: fit.assessment.alerts.map((alert) => ({
          ...alert,
          params: alertParams.get(alert.code) ?? {},
        })),
        recommended_cv_version_id: cv.cvVersionId,
        suggested_salary: {
          ...salary,
          recommendation: {
            trackId: cv.trackId,
            language: cv.language,
            reason: cv.reason,
          },
        },
        model_version: [options.extractModel, fit.model]
          .filter(Boolean)
          .join(" + "),
        prompt_version: [options.extractPromptVersion, fit.promptVersion]
          .filter(Boolean)
          .join(" + "),
      },
      { onConflict: "user_id,job_posting_id" }
    )
    .select("id")
    .single()
  if (error || !data)
    throw new Error(`job_matches upsert failed: ${error?.message}`)
  return {
    matchId: String((data as { id: string }).id),
    blocked: false,
    fit: fit.assessment.fit,
  }
}

export function normalizedCompany(company: string | null): string | null {
  return company ? normalizeCompanyName(company) : null
}
