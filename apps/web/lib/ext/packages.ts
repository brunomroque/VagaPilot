import "server-only"

import {
  applicationPackagePayloadSchema,
  PACKAGE_TTL_MS,
  type ApplicationPackagePayload,
} from "@vagapilot/core/application-package"
import { signedCvDownload } from "@/lib/cvs/server"
import {
  openColumnJson,
  openColumnText,
  sealForColumn,
} from "@/lib/server/field-crypto"
import type { UserContext } from "@/lib/server/context"
import { audit } from "@/lib/server/audit"
import { getAdminClient } from "@/lib/server/admin"

export { buildApplyUrl } from "@vagapilot/core/apply-url"

async function loadPackagePayload(
  ctx: UserContext,
  applicationId: string
): Promise<ApplicationPackagePayload | null> {
  const [{ data, error }, profileResult] = await Promise.all([
    ctx.supabase
      .from("applications")
      .select("id, company, role_title, source, cv_version_id, salary_informed")
      .eq("id", applicationId)
      .eq("user_id", ctx.user.id)
      .maybeSingle(),
    ctx.supabase
      .from("candidate_profiles")
      .select(
        "first_name, last_name, display_name, email_contact, city, state, country, linkedin_url, portfolio_url, phone_enc, documents_enc"
      )
      .eq("user_id", ctx.user.id)
      .maybeSingle(),
  ])
  if (error || !data || profileResult.error) return null

  const row = data as {
    id: string
    company: string
    role_title: string
    source: string
    cv_version_id: string | null
    salary_informed: {
      amount: number
      currency: string
      regime: string | null
    } | null
  }

  const profile = profileResult.data as {
    first_name: string | null
    last_name: string | null
    display_name: string
    email_contact: string | null
    city: string | null
    state: string | null
    country: string | null
    linkedin_url: string | null
    portfolio_url: string | null
    phone_enc: string | null
    documents_enc: string | null
  } | null
  const userId = ctx.user.id
  const phone = await openColumnText(userId, profile?.phone_enc ?? null)
  const documents = await openColumnJson<Record<string, string>>(
    userId,
    profile?.documents_enc ?? null
  )

  const [answers, facts] = await Promise.all([
    ctx.supabase
      .from("standard_answers")
      .select("key, question_examples, answer, answer_enc, is_sensitive")
      .eq("user_id", userId),
    ctx.supabase
      .from("confirmed_facts")
      .select("id, statement, kind")
      .eq("user_id", userId)
      .eq("status", "confirmado"),
  ])
  if (answers.error || facts.error) throw new Error("package_read_failed")

  const standardAnswers = await Promise.all(
    (answers.data ?? []).map(async (answer) => {
      const plain =
        answer.is_sensitive && answer.answer_enc
          ? await openColumnText(userId, answer.answer_enc as string)
          : (answer.answer as string | null)
      return {
        key: answer.key as string,
        questionExamples: (answer.question_examples as string[]) ?? [],
        answer: plain ?? "",
        proposedFrom: {
          kind: "standard_answer" as const,
          ref: answer.key as string,
        },
      }
    })
  )

  const payload: ApplicationPackagePayload = {
    version: 1,
    applicationId: row.id,
    jobSource: row.source,
    company: row.company,
    roleTitle: row.role_title,
    profile: {
      firstName: profile?.first_name ?? null,
      lastName: profile?.last_name ?? null,
      displayName: profile?.display_name ?? "Candidato",
      email: profile?.email_contact ?? null,
      phone,
      city: profile?.city ?? null,
      state: profile?.state ?? null,
      country: profile?.country ?? "BR",
      linkedinUrl: profile?.linkedin_url ?? null,
      portfolioUrl: profile?.portfolio_url ?? null,
      cpf: documents?.cpf ?? null,
      documents,
    },
    standardAnswers: standardAnswers.filter((item) => item.answer.trim()),
    facts: (facts.data ?? []).map((fact) => ({
      id: fact.id as string,
      statement: fact.statement as string,
      kind: fact.kind as string,
    })),
    cvVersionId: row.cv_version_id,
    salaryInformed: row.salary_informed,
  }
  return applicationPackagePayloadSchema.parse(payload)
}

/** Creates an encrypted snapshot for the extension (spec 8.4, 24 h). */
export async function createApplicationPackage(
  ctx: UserContext,
  applicationId: string
): Promise<{ packageId: string }> {
  const payload = await loadPackagePayload(ctx, applicationId)
  if (!payload) throw new Error("not_found")
  const sealed = await sealForColumn(ctx.user.id, payload)
  if (!sealed) throw new Error("seal_failed")
  const expiresAt = new Date(Date.now() + PACKAGE_TTL_MS).toISOString()
  const inserted = await ctx.supabase
    .from("application_packages")
    .insert({
      user_id: ctx.user.id,
      application_id: applicationId,
      payload_enc: sealed,
      cv_version_id: payload.cvVersionId,
      expires_at: expiresAt,
    })
    .select("id")
    .single()
  if (inserted.error || !inserted.data) {
    throw new Error(`package_insert_failed:${inserted.error?.message}`)
  }
  await audit({
    userId: ctx.user.id,
    actor: "sistema",
    action: "package.created",
    targetType: "application",
    targetId: applicationId,
    details: { package_id: (inserted.data as { id: string }).id },
  })
  return { packageId: (inserted.data as { id: string }).id }
}

export async function fetchPackageForDevice(
  userId: string,
  applicationId: string
): Promise<{
  packageId: string
  payload: ApplicationPackagePayload
  cv: { versionId: string; filename: string; downloadUrl: string } | null
  expiresAt: string
} | null> {
  const admin = getAdminClient()
  if (!admin) return null
  const { data, error } = await admin
    .from("application_packages")
    .select("id, payload_enc, cv_version_id, expires_at, consumed_at")
    .eq("user_id", userId)
    .eq("application_id", applicationId)
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error || !data) return null
  const row = data as {
    id: string
    payload_enc: string
    cv_version_id: string | null
    expires_at: string
  }
  const json = await openColumnText(userId, row.payload_enc)
  if (!json) return null
  const payload = applicationPackagePayloadSchema.parse(JSON.parse(json))

  let cv: { versionId: string; filename: string; downloadUrl: string } | null =
    null
  if (row.cv_version_id) {
    const signed = await signedCvDownload(
      { user: { id: userId }, supabase: admin } as UserContext,
      row.cv_version_id
    )
    if (signed) {
      cv = {
        versionId: row.cv_version_id,
        filename: signed.filename,
        downloadUrl: signed.url,
      }
    }
  }

  return {
    packageId: row.id,
    payload,
    cv,
    expiresAt: row.expires_at,
  }
}

export async function markPackageConsumed(
  userId: string,
  packageId: string
): Promise<void> {
  const admin = getAdminClient()
  if (!admin) return
  await admin
    .from("application_packages")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", packageId)
    .eq("user_id", userId)
  await audit({
    userId,
    actor: "extensao",
    action: "package.consumed",
    targetType: "application_package",
    targetId: packageId,
  })
}
