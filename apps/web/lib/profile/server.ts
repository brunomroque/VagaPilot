import "server-only"

import {
  canStoreDiversityData,
  type ConsentRecord,
} from "@vagapilot/core/consents"

import { openColumnJson, openColumnText } from "@/lib/server/field-crypto"
import type { UserContext } from "@/lib/server/context"

import {
  DEFAULT_DIVERSITY,
  type AddressInput,
  type DiversityInput,
  type DocumentsInput,
  type ProfilePreferences,
} from "./schemas"

type ProfileRow = {
  user_id: string
  display_name: string
  first_name: string | null
  last_name: string | null
  email_contact: string | null
  phone_enc: string | null
  city: string | null
  state: string | null
  country: string | null
  address_enc: string | null
  documents_enc: string | null
  linkedin_url: string | null
  portfolio_url: string | null
  birth_date_enc: string | null
  diversity_enc: string | null
  preferences: ProfilePreferences | null
  cv_filename_pattern: string
}

export type ExperienceRow = {
  id: string
  company: string
  title: string
  employment_type: string
  /** Null when imported from a CV without dates (pending item for the user). */
  start_date: string | null
  end_date: string | null
  is_current: boolean | null
  location: string | null
  description: string | null
  sort_order: number | null
}

export type EducationRow = {
  id: string
  institution: string
  degree: string | null
  field: string | null
  level: string | null
  start_date: string | null
  end_date: string | null
  status: string | null
}

export type LanguageRow = {
  id: string
  language: string
  level: string
  cefr: string | null
}

export type SalaryRuleRow = {
  id: string
  seniority: string
  regime: string
  amount_min: number | null
  amount_target: number
  currency: string | null
  period: string | null
}

export type StandardAnswerRow = {
  id: string
  key: string
  question_examples: string[] | null
  answer: string | null
  answer_enc: string | null
  language: string | null
  is_sensitive: boolean | null
}

export type BlockedCompanyRow = {
  id: string
  company_name: string
  normalized_name: string
  aliases: string[] | null
  domains: string[] | null
  reason: string | null
}

export type SkillRow = { id: string; statement: string }

export type ProfileView = {
  exists: boolean
  displayName: string
  firstName: string
  lastName: string
  emailContact: string
  phone: string
  birthDate: string
  city: string
  state: string
  linkedinUrl: string
  portfolioUrl: string
  cvFilenamePattern: string
  address: AddressInput
  documents: DocumentsInput
  preferences: ProfilePreferences
}

export type StandardAnswerView = {
  id: string
  key: string
  question: string
  answer: string
  isSensitive: boolean
  language: string
}

export type ProfileBundle = {
  profile: ProfileView
  experiences: ExperienceRow[]
  educations: EducationRow[]
  languages: LanguageRow[]
  skills: SkillRow[]
  salaryRules: SalaryRuleRow[]
  answers: StandardAnswerView[]
  blocklist: BlockedCompanyRow[]
  diversityConsent: boolean
  diversity: DiversityInput
}

const EMPTY_ADDRESS: AddressInput = {
  postalCode: "",
  street: "",
  number: "",
  complement: "",
  district: "",
}
const EMPTY_DOCUMENTS: DocumentsInput = { cpf: "", rg: "", cnh: "" }

function must<T>(
  result: { data: T | null; error: { message: string } | null },
  what: string
): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`)
  return result.data as T
}

export async function loadProfileRow(
  ctx: UserContext
): Promise<ProfileRow | null> {
  return must(
    await ctx.supabase
      .from("candidate_profiles")
      .select("*")
      .eq("user_id", ctx.user.id)
      .maybeSingle<ProfileRow>(),
    "candidate_profiles"
  )
}

/** Creates the 1—1 profile row on first write (signup does not create it). */
export async function ensureProfileRow(ctx: UserContext): Promise<ProfileRow> {
  const existing = await loadProfileRow(ctx)
  if (existing) return existing
  const [first, ...rest] = ctx.user.displayName.trim().split(/\s+/)
  return must(
    await ctx.supabase
      .from("candidate_profiles")
      .insert({
        user_id: ctx.user.id,
        display_name: ctx.user.displayName || ctx.user.email,
        first_name: first ?? null,
        last_name: rest.join(" ") || null,
        email_contact: ctx.user.email || null,
      })
      .select("*")
      .single<ProfileRow>(),
    "candidate_profiles insert"
  )
}

export async function loadPreferences(
  ctx: UserContext
): Promise<ProfilePreferences> {
  return (await loadProfileRow(ctx))?.preferences ?? {}
}

/** Read-modify-write of the preferences jsonb (single user, low contention). */
export async function updatePreferences(
  ctx: UserContext,
  patch: Partial<ProfilePreferences>
): Promise<ProfilePreferences> {
  const row = await ensureProfileRow(ctx)
  const next = { ...(row.preferences ?? {}), ...patch }
  must(
    await ctx.supabase
      .from("candidate_profiles")
      .update({ preferences: next })
      .eq("user_id", ctx.user.id),
    "preferences update"
  )
  return next
}

export async function loadConsents(ctx: UserContext): Promise<ConsentRecord[]> {
  const rows = must(
    await ctx.supabase
      .from("consents")
      .select("purpose, granted, created_at")
      .eq("user_id", ctx.user.id),
    "consents"
  ) as { purpose: string; granted: boolean; created_at: string }[]
  return rows.map((row) => ({
    purpose: row.purpose,
    granted: row.granted,
    createdAt: row.created_at,
  }))
}

export async function hasDiversityConsent(ctx: UserContext): Promise<boolean> {
  return canStoreDiversityData(await loadConsents(ctx))
}

async function decryptAnswers(
  ctx: UserContext,
  rows: StandardAnswerRow[]
): Promise<StandardAnswerView[]> {
  return Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      key: row.key,
      question: row.question_examples?.[0] ?? "",
      answer: row.is_sensitive
        ? ((await openColumnText(ctx.user.id, row.answer_enc)) ?? "")
        : (row.answer ?? ""),
      isSensitive: row.is_sensitive === true,
      language: row.language ?? "pt-BR",
    }))
  )
}

export async function loadStandardAnswers(
  ctx: UserContext
): Promise<StandardAnswerView[]> {
  const rows = must(
    await ctx.supabase
      .from("standard_answers")
      .select(
        "id, key, question_examples, answer, answer_enc, language, is_sensitive"
      )
      .eq("user_id", ctx.user.id)
      .order("key"),
    "standard_answers"
  ) as StandardAnswerRow[]
  return decryptAnswers(ctx, rows)
}

export async function loadProfileBundle(
  ctx: UserContext
): Promise<ProfileBundle> {
  const userId = ctx.user.id
  const [
    row,
    experiences,
    educations,
    languages,
    skills,
    salaryRules,
    answers,
    blocklist,
    consents,
  ] = await Promise.all([
    loadProfileRow(ctx),
    ctx.supabase
      .from("experiences")
      .select(
        "id, company, title, employment_type, start_date, end_date, is_current, location, description, sort_order"
      )
      .eq("user_id", userId)
      .order("is_current", { ascending: false })
      .order("start_date", { ascending: false }),
    ctx.supabase
      .from("educations")
      .select(
        "id, institution, degree, field, level, start_date, end_date, status"
      )
      .eq("user_id", userId)
      .order("start_date", { ascending: false, nullsFirst: true }),
    ctx.supabase
      .from("languages")
      .select("id, language, level, cefr")
      .eq("user_id", userId)
      .order("language"),
    ctx.supabase
      .from("confirmed_facts")
      .select("id, statement")
      .eq("user_id", userId)
      .eq("kind", "competencia")
      .eq("source", "manual")
      .eq("status", "confirmado")
      .order("created_at"),
    ctx.supabase
      .from("salary_rules")
      .select(
        "id, seniority, regime, amount_min, amount_target, currency, period"
      )
      .eq("user_id", userId),
    loadStandardAnswers(ctx),
    ctx.supabase
      .from("company_blocklist")
      .select("id, company_name, normalized_name, aliases, domains, reason")
      .eq("user_id", userId)
      .order("company_name"),
    loadConsents(ctx),
  ])

  const diversityConsent = canStoreDiversityData(consents)
  const [phone, birthDate, address, documents, diversity] = row
    ? await Promise.all([
        openColumnText(userId, row.phone_enc),
        openColumnText(userId, row.birth_date_enc),
        openColumnJson<AddressInput>(userId, row.address_enc),
        openColumnJson<DocumentsInput>(userId, row.documents_enc),
        diversityConsent
          ? openColumnJson<DiversityInput>(userId, row.diversity_enc)
          : Promise.resolve(null),
      ])
    : [null, null, null, null, null]

  const [first, ...rest] = ctx.user.displayName.trim().split(/\s+/)
  return {
    profile: {
      exists: Boolean(row),
      displayName: row?.display_name ?? ctx.user.displayName,
      firstName: row?.first_name ?? first ?? "",
      lastName: row?.last_name ?? rest.join(" "),
      emailContact: row?.email_contact ?? ctx.user.email,
      phone: phone ?? "",
      birthDate: birthDate ?? "",
      city: row?.city ?? "",
      state: row?.state?.trim() ?? "",
      linkedinUrl: row?.linkedin_url ?? "",
      portfolioUrl: row?.portfolio_url ?? "",
      cvFilenamePattern: row?.cv_filename_pattern ?? "CV-{first}-{last}-{lang}",
      address: { ...EMPTY_ADDRESS, ...address },
      documents: { ...EMPTY_DOCUMENTS, ...documents },
      preferences: row?.preferences ?? {},
    },
    experiences: must(experiences, "experiences") as ExperienceRow[],
    educations: must(educations, "educations") as EducationRow[],
    languages: must(languages, "languages") as LanguageRow[],
    skills: must(skills, "skills") as SkillRow[],
    salaryRules: must(salaryRules, "salary_rules") as SalaryRuleRow[],
    answers,
    blocklist: must(blocklist, "company_blocklist") as BlockedCompanyRow[],
    diversityConsent,
    diversity: { ...DEFAULT_DIVERSITY, ...diversity },
  }
}
