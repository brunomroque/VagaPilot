"use server"

import {
  normalizeCompanyName,
  normalizeDomain,
} from "@vagapilot/core/blocklist"
import { formatCpf } from "@vagapilot/core/br-documents"
import { createEmbedder } from "@vagapilot/ai"
import { refresh } from "next/cache"
import { z } from "zod"

import {
  addressSchema,
  blockedCompanySchema,
  contactSchema,
  diversitySchema,
  documentsSchema,
  educationSchema,
  experienceSchema,
  languageSchema,
  parseAmount,
  preferencesSchema,
  salaryRuleSchema,
  SENSITIVE_ANSWER_KEYS,
  situationSchema,
  skillSchema,
  splitList,
  standardAnswerSchema,
} from "@/lib/profile/schemas"
import {
  ensureProfileRow,
  hasDiversityConsent,
  updatePreferences,
} from "@/lib/profile/server"
import { audit } from "@/lib/server/audit"
import {
  fail,
  getUserContext,
  ok,
  type ActionResult,
  type UserContext,
} from "@/lib/server/context"
import { sealForColumn } from "@/lib/server/field-crypto"

type Section =
  | "contact"
  | "address"
  | "documents"
  | "experience"
  | "education"
  | "language"
  | "skill"
  | "preferences"
  | "situation"
  | "salary_rule"
  | "standard_answer"
  | "blocklist"
  | "diversity"
  | "diversity_consent"

async function run<T>(
  section: Section,
  work: (ctx: UserContext) => Promise<ActionResult<T>>
): Promise<ActionResult<T>> {
  const context = await getUserContext()
  if (!context.ok) return { ok: false, error: context.error }
  try {
    const result = await work(context.ctx)
    if (result.ok) {
      await audit({
        userId: context.ctx.user.id,
        actor: "usuario",
        action: "settings.changed",
        targetType: "candidate_profile",
        details: { section },
      })
      refresh()
    }
    return result
  } catch (error) {
    console.error(
      `[profile:${section}]`,
      error instanceof Error ? error.message : error
    )
    return fail("internal_error", "Could not save.")
  }
}

function parse<S extends z.ZodType>(
  schema: S,
  input: unknown
): z.infer<S> | null {
  const parsed = schema.safeParse(input)
  return parsed.success ? parsed.data : null
}

const nullable = (value: string) => (value.trim() === "" ? null : value.trim())
const monthToDate = (value: string) => (value ? `${value}-01` : null)
const yearToDate = (value: string) => (value ? `${value}-01-01` : null)

function checked<T>(result: {
  error: { message: string } | null
  data?: T | null
}): T | null {
  if (result.error) throw new Error(result.error.message)
  return result.data ?? null
}

export async function saveContact(input: unknown) {
  return run("contact", async (ctx) => {
    const data = parse(contactSchema, input)
    if (!data) return fail("invalid_request", "Invalid contact data.")
    await ensureProfileRow(ctx)
    checked(
      await ctx.supabase
        .from("candidate_profiles")
        .update({
          display_name: data.displayName,
          first_name: data.firstName,
          last_name: data.lastName,
          email_contact: nullable(data.emailContact),
          phone_enc: await sealForColumn(ctx.user.id, data.phone),
          birth_date_enc: await sealForColumn(ctx.user.id, data.birthDate),
          city: nullable(data.city),
          state: nullable(data.state.toUpperCase()),
          linkedin_url: nullable(data.linkedinUrl),
          portfolio_url: nullable(data.portfolioUrl),
          cv_filename_pattern: data.cvFilenamePattern,
        })
        .eq("user_id", ctx.user.id)
    )
    return ok(undefined)
  })
}

export async function saveAddress(input: unknown) {
  return run("address", async (ctx) => {
    const data = parse(addressSchema, input)
    if (!data) return fail("invalid_request", "Invalid address.")
    await ensureProfileRow(ctx)
    const empty = Object.values(data).every((value) => value === "")
    checked(
      await ctx.supabase
        .from("candidate_profiles")
        .update({
          address_enc: empty ? null : await sealForColumn(ctx.user.id, data),
        })
        .eq("user_id", ctx.user.id)
    )
    return ok(undefined)
  })
}

export async function saveDocuments(input: unknown) {
  return run("documents", async (ctx) => {
    const data = parse(documentsSchema, input)
    if (!data) return fail("invalid_request", "Invalid documents.")
    await ensureProfileRow(ctx)
    const normalized = { ...data, cpf: data.cpf ? formatCpf(data.cpf) : "" }
    const empty = Object.values(normalized).every((value) => value === "")
    checked(
      await ctx.supabase
        .from("candidate_profiles")
        .update({
          documents_enc: empty
            ? null
            : await sealForColumn(ctx.user.id, normalized),
        })
        .eq("user_id", ctx.user.id)
    )
    return ok(undefined)
  })
}

export async function saveExperience(input: unknown) {
  return run("experience", async (ctx) => {
    const data = parse(experienceSchema, input)
    if (!data) return fail("invalid_request", "Invalid experience.")
    const row = {
      user_id: ctx.user.id,
      company: data.company,
      title: data.title,
      employment_type: data.employmentType,
      start_date: monthToDate(data.startMonth),
      end_date: data.isCurrent ? null : monthToDate(data.endMonth),
      is_current: data.isCurrent,
      location: nullable(data.location),
      description: nullable(data.description),
    }
    const result = data.id
      ? await ctx.supabase
          .from("experiences")
          .update(row)
          .eq("id", data.id)
          .eq("user_id", ctx.user.id)
          .select("id")
      : await ctx.supabase.from("experiences").insert(row).select("id")
    const rows = checked(result) as { id: string }[] | null
    if (!rows?.[0]) return fail("not_found", "Experience not found.")
    return ok({ id: rows[0].id })
  })
}

export async function deleteExperience(id: string) {
  return run("experience", async (ctx) => {
    if (!z.uuid().safeParse(id).success)
      return fail("invalid_request", "Invalid id.")
    checked(
      await ctx.supabase
        .from("experiences")
        .delete()
        .eq("id", id)
        .eq("user_id", ctx.user.id)
    )
    return ok(undefined)
  })
}

export async function saveEducation(input: unknown) {
  return run("education", async (ctx) => {
    const data = parse(educationSchema, input)
    if (!data) return fail("invalid_request", "Invalid education.")
    const row = {
      user_id: ctx.user.id,
      institution: data.institution,
      degree: nullable(data.degree),
      field: nullable(data.field),
      level: data.level,
      status: data.status,
      start_date: yearToDate(data.startYear),
      end_date: yearToDate(data.endYear),
    }
    const result = data.id
      ? await ctx.supabase
          .from("educations")
          .update(row)
          .eq("id", data.id)
          .eq("user_id", ctx.user.id)
          .select("id")
      : await ctx.supabase.from("educations").insert(row).select("id")
    const rows = checked(result) as { id: string }[] | null
    if (!rows?.[0]) return fail("not_found", "Education not found.")
    return ok(undefined)
  })
}

export async function deleteEducation(id: string) {
  return run("education", async (ctx) => {
    if (!z.uuid().safeParse(id).success)
      return fail("invalid_request", "Invalid id.")
    checked(
      await ctx.supabase
        .from("educations")
        .delete()
        .eq("id", id)
        .eq("user_id", ctx.user.id)
    )
    return ok(undefined)
  })
}

export async function saveLanguage(input: unknown) {
  return run("language", async (ctx) => {
    const data = parse(languageSchema, input)
    if (!data) return fail("invalid_request", "Invalid language.")
    const row = {
      user_id: ctx.user.id,
      language: data.language,
      level: data.level,
      cefr: data.cefr || null,
    }
    const result = data.id
      ? await ctx.supabase
          .from("languages")
          .update(row)
          .eq("id", data.id)
          .eq("user_id", ctx.user.id)
          .select("id")
      : await ctx.supabase.from("languages").insert(row).select("id")
    const rows = checked(result) as { id: string }[] | null
    if (!rows?.[0]) return fail("not_found", "Language not found.")
    return ok(undefined)
  })
}

export async function deleteLanguage(id: string) {
  return run("language", async (ctx) => {
    if (!z.uuid().safeParse(id).success)
      return fail("invalid_request", "Invalid id.")
    checked(
      await ctx.supabase
        .from("languages")
        .delete()
        .eq("id", id)
        .eq("user_id", ctx.user.id)
    )
    return ok(undefined)
  })
}

/** Skills typed by the user are their own statements: stored as confirmed manual facts. */
export async function addSkill(input: unknown) {
  return run("skill", async (ctx) => {
    const data = parse(skillSchema, input)
    if (!data) return fail("invalid_request", "Invalid skill.")
    const embedding = await createEmbedder().embed(data.name)
    const rows = checked(
      await ctx.supabase
        .from("confirmed_facts")
        .insert({
          user_id: ctx.user.id,
          statement: data.name,
          kind: "competencia",
          tags: [data.name.toLowerCase()],
          status: "confirmado",
          source: "manual",
          confirmed_at: new Date().toISOString(),
          embedding: JSON.stringify(embedding),
        })
        .select("id")
    ) as { id: string }[] | null
    const id = rows?.[0]?.id
    if (!id) return fail("internal_error", "Skill not saved.")
    await audit({
      userId: ctx.user.id,
      actor: "usuario",
      action: "fact.confirmed",
      targetType: "confirmed_fact",
      targetId: id,
      details: { source: "manual", kind: "competencia" },
    })
    return ok(undefined)
  })
}

export async function removeSkill(id: string) {
  return run("skill", async (ctx) => {
    if (!z.uuid().safeParse(id).success)
      return fail("invalid_request", "Invalid id.")
    const rows = checked(
      await ctx.supabase
        .from("confirmed_facts")
        .update({ status: "rejeitado" })
        .eq("id", id)
        .eq("user_id", ctx.user.id)
        .select("id")
    ) as { id: string }[] | null
    if (!rows?.[0]) return fail("not_found", "Skill not found.")
    await audit({
      userId: ctx.user.id,
      actor: "usuario",
      action: "fact.rejected",
      targetType: "confirmed_fact",
      targetId: id,
      details: { source: "manual", kind: "competencia", revoked: true },
    })
    return ok(undefined)
  })
}

export async function savePreferences(input: unknown) {
  return run("preferences", async (ctx) => {
    const data = parse(preferencesSchema, input)
    if (!data) return fail("invalid_request", "Invalid preferences.")
    await updatePreferences(ctx, {
      workModels: data.workModels,
      regimes: data.regimes,
      cities: splitList(data.cities),
      availability: data.availability,
      travel: data.travel,
      relocation: data.relocation,
    })
    return ok(undefined)
  })
}

/** RF1A.2: current situation; the current pay is a sensitive standard answer. */
export async function saveSituation(input: unknown) {
  return run("situation", async (ctx) => {
    const data = parse(situationSchema, input)
    if (!data) return fail("invalid_request", "Invalid situation.")
    await updatePreferences(ctx, {
      situation: {
        situation: data.situation,
        currentCompany: nullable(data.currentCompany) ?? undefined,
        currentPayMode: data.currentPayMode,
      },
    })
    if (data.currentPayMode === "prefiro_nao_informar") {
      checked(
        await ctx.supabase
          .from("standard_answers")
          .delete()
          .eq("user_id", ctx.user.id)
          .eq("key", "remuneracao_atual")
      )
    } else {
      const answer = data.currentPayMode === "zero" ? "0" : data.currentPay
      checked(
        await ctx.supabase.from("standard_answers").upsert(
          {
            user_id: ctx.user.id,
            key: "remuneracao_atual",
            language: "pt-BR",
            question_examples: ["Qual sua remuneração atual?"],
            answer: null,
            answer_enc: await sealForColumn(ctx.user.id, answer),
            is_sensitive: true,
          },
          { onConflict: "user_id,key,language" }
        )
      )
    }
    return ok(undefined)
  })
}

export async function saveSalaryRule(input: unknown) {
  return run("salary_rule", async (ctx) => {
    const data = parse(salaryRuleSchema, input)
    if (!data) return fail("invalid_request", "Invalid salary rule.")
    const row = {
      user_id: ctx.user.id,
      seniority: data.seniority,
      regime: data.regime,
      amount_min: data.amountMin ? parseAmount(data.amountMin) : null,
      amount_target: parseAmount(data.amountTarget),
      currency: data.currency,
      period: data.period,
    }
    if (data.id) {
      const rows = checked(
        await ctx.supabase
          .from("salary_rules")
          .update(row)
          .eq("id", data.id)
          .eq("user_id", ctx.user.id)
          .select("id")
      ) as { id: string }[] | null
      if (!rows?.[0]) return fail("not_found", "Rule not found.")
      return ok(undefined)
    }
    const result = await ctx.supabase.from("salary_rules").insert(row)
    if (result.error?.code === "23505") {
      return fail(
        "conflict",
        "A rule for this seniority and regime already exists."
      )
    }
    checked(result)
    return ok(undefined)
  })
}

export async function deleteSalaryRule(id: string) {
  return run("salary_rule", async (ctx) => {
    if (!z.uuid().safeParse(id).success)
      return fail("invalid_request", "Invalid id.")
    checked(
      await ctx.supabase
        .from("salary_rules")
        .delete()
        .eq("id", id)
        .eq("user_id", ctx.user.id)
    )
    return ok(undefined)
  })
}

export async function saveStandardAnswer(input: unknown) {
  return run("standard_answer", async (ctx) => {
    const data = parse(standardAnswerSchema, input)
    if (!data) return fail("invalid_request", "Invalid answer.")
    const sensitive = data.isSensitive || SENSITIVE_ANSWER_KEYS.has(data.key)
    const row = {
      user_id: ctx.user.id,
      key: data.key,
      language: data.language,
      question_examples: data.question ? [data.question] : [],
      answer: sensitive ? null : data.answer,
      answer_enc: sensitive
        ? await sealForColumn(ctx.user.id, data.answer)
        : null,
      is_sensitive: sensitive,
      updated_at: new Date().toISOString(),
    }
    if (data.id) {
      const rows = checked(
        await ctx.supabase
          .from("standard_answers")
          .update(row)
          .eq("id", data.id)
          .eq("user_id", ctx.user.id)
          .select("id")
      ) as { id: string }[] | null
      if (!rows?.[0]) return fail("not_found", "Answer not found.")
      return ok(undefined)
    }
    const result = await ctx.supabase.from("standard_answers").insert(row)
    if (result.error?.code === "23505") {
      return fail(
        "conflict",
        "This key already has an answer in this language."
      )
    }
    checked(result)
    return ok(undefined)
  })
}

export async function deleteStandardAnswer(id: string) {
  return run("standard_answer", async (ctx) => {
    if (!z.uuid().safeParse(id).success)
      return fail("invalid_request", "Invalid id.")
    checked(
      await ctx.supabase
        .from("standard_answers")
        .delete()
        .eq("id", id)
        .eq("user_id", ctx.user.id)
    )
    return ok(undefined)
  })
}

export async function saveBlockedCompany(input: unknown) {
  return run("blocklist", async (ctx) => {
    const data = parse(blockedCompanySchema, input)
    if (!data) return fail("invalid_request", "Invalid company.")
    const row = {
      user_id: ctx.user.id,
      company_name: data.companyName,
      normalized_name: normalizeCompanyName(data.companyName),
      aliases: splitList(data.aliases),
      domains: splitList(data.domains).map(normalizeDomain).filter(Boolean),
      reason: nullable(data.reason),
    }
    const result = data.id
      ? await ctx.supabase
          .from("company_blocklist")
          .update(row)
          .eq("id", data.id)
          .eq("user_id", ctx.user.id)
          .select("id")
      : await ctx.supabase.from("company_blocklist").insert(row).select("id")
    const rows = checked(result) as { id: string }[] | null
    if (!rows?.[0]) return fail("not_found", "Company not found.")
    return ok(undefined)
  })
}

export async function deleteBlockedCompany(id: string) {
  return run("blocklist", async (ctx) => {
    if (!z.uuid().safeParse(id).success)
      return fail("invalid_request", "Invalid id.")
    checked(
      await ctx.supabase
        .from("company_blocklist")
        .delete()
        .eq("id", id)
        .eq("user_id", ctx.user.id)
    )
    return ok(undefined)
  })
}

/** CA1.3: consent toggle writes `consents`; revoking also erases the stored diversity data. */
export async function setDiversityConsent(granted: boolean) {
  return run("diversity_consent", async (ctx) => {
    if (typeof granted !== "boolean")
      return fail("invalid_request", "Invalid consent.")
    checked(
      await ctx.supabase.from("consents").insert({
        user_id: ctx.user.id,
        purpose: "diversidade",
        version: "v1",
        granted,
      })
    )
    if (!granted) {
      await ensureProfileRow(ctx)
      checked(
        await ctx.supabase
          .from("candidate_profiles")
          .update({ diversity_enc: null })
          .eq("user_id", ctx.user.id)
      )
    }
    return ok(undefined)
  })
}

export async function saveDiversity(input: unknown) {
  return run("diversity", async (ctx) => {
    if (!(await hasDiversityConsent(ctx))) {
      return fail(
        "consent_required",
        "Diversity data needs the 'diversidade' consent."
      )
    }
    const data = parse(diversitySchema, input)
    if (!data) return fail("invalid_request", "Invalid diversity data.")
    await ensureProfileRow(ctx)
    checked(
      await ctx.supabase
        .from("candidate_profiles")
        .update({ diversity_enc: await sealForColumn(ctx.user.id, data) })
        .eq("user_id", ctx.user.id)
    )
    return ok(undefined)
  })
}
