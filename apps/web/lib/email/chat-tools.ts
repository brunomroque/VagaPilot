import "server-only"

import { draftApplicationEmail } from "@vagapilot/ai"
import { hashEmailDraftSnapshot } from "@vagapilot/core/application-email"

import type { ChatToolOutput } from "@/lib/chat/types"
import { decideApproval } from "@/lib/approvals/decide"
import { assertFeatureEnabled } from "@/lib/entitlements/server"
import { audit } from "@/lib/server/audit"
import type { UserContext } from "@/lib/server/context"

export async function toolDraftApplicationEmail(
  ctx: UserContext,
  applicationId: string,
  summary: string
): Promise<ChatToolOutput> {
  await assertFeatureEnabled(ctx.user.id, "emailApplications")

  const app = await ctx.supabase
    .from("applications")
    .select("id, role_title, company, job_posting_id, cv_version_id")
    .eq("id", applicationId)
    .eq("user_id", ctx.user.id)
    .maybeSingle()
  const appRow = app.data as {
    id: string
    role_title: string
    company: string
    job_posting_id: string | null
    cv_version_id: string | null
  } | null
  if (!appRow) return { kind: "error", code: "not_found", summary }

  let description = ""
  let applyEmail: string | null = null
  if (appRow.job_posting_id) {
    const posting = await ctx.supabase
      .from("job_postings")
      .select("description_md, apply_email, title, company")
      .eq("id", appRow.job_posting_id)
      .maybeSingle()
    const p = posting.data as {
      description_md: string | null
      apply_email: string | null
      title: string
      company: string | null
    } | null
    description = p?.description_md ?? ""
    applyEmail = p?.apply_email ?? null
  }

  const pref = await ctx.supabase
    .from("preferences")
    .select("value")
    .eq("user_id", ctx.user.id)
    .eq("key", "email.include_salary")
    .maybeSingle()
  const includeSalaryWhenAsked =
    (pref.data as { value?: boolean } | null)?.value !== false

  const profile = await ctx.supabase
    .from("candidate_profiles")
    .select("display_name, first_name, last_name")
    .eq("user_id", ctx.user.id)
    .maybeSingle()
  const name =
    (profile.data as { display_name?: string } | null)?.display_name ??
    "Candidato Fictício"

  const facts = await ctx.supabase
    .from("confirmed_facts")
    .select("statement")
    .eq("user_id", ctx.user.id)
    .eq("status", "confirmado")
    .limit(5)
  const groundingBullets = ((facts.data ?? []) as { statement: string }[]).map(
    (f) => f.statement
  )

  let draft
  try {
    draft = await draftApplicationEmail({
      candidateName: name,
      roleTitle: appRow.role_title,
      company: appRow.company,
      jobDescription: description,
      includeSalaryWhenAsked,
      groundingBullets,
    })
  } catch {
    return { kind: "error", code: "draft_invalid", summary }
  }

  const to = applyEmail ? [applyEmail] : []
  if (to.length === 0) {
    return { kind: "error", code: "no_recipient", summary }
  }

  const inserted = await ctx.supabase
    .from("email_drafts")
    .insert({
      user_id: ctx.user.id,
      application_id: appRow.id,
      to_addresses: to,
      subject: draft.subject,
      body_md: draft.bodyMd,
      attachment_cv_version_id: appRow.cv_version_id,
      status: "rascunho",
    })
    .select("id")
    .single()
  if (inserted.error || !inserted.data) {
    return { kind: "error", code: "write_failed", summary }
  }
  const draftId = String((inserted.data as { id: string }).id)

  return {
    kind: "email_draft",
    draftId,
    subject: draft.subject,
    bodyMd: draft.bodyMd,
    to,
    summary,
  }
}

export async function toolRequestSendEmail(
  ctx: UserContext,
  draftId: string,
  summary: string
): Promise<ChatToolOutput> {
  const draft = await ctx.supabase
    .from("email_drafts")
    .select("*")
    .eq("id", draftId)
    .eq("user_id", ctx.user.id)
    .maybeSingle()
  const row = draft.data as {
    id: string
    application_id: string | null
    to_addresses: string[]
    cc_addresses: string[] | null
    subject: string
    body_md: string
    attachment_cv_version_id: string | null
  } | null
  if (!row) return { kind: "error", code: "not_found", summary }

  const preview = {
    subject: row.subject,
    to: row.to_addresses,
    excerpt: row.body_md.slice(0, 280),
  }
  const hash = hashEmailDraftSnapshot({
    to: row.to_addresses,
    cc: row.cc_addresses ?? [],
    subject: row.subject,
    bodyMd: row.body_md,
    attachmentCvVersionId: row.attachment_cv_version_id,
  })

  const approval = await ctx.supabase
    .from("approvals")
    .insert({
      user_id: ctx.user.id,
      kind: "enviar_email",
      application_id: row.application_id,
      subject_ref: { draft_id: row.id },
      preview,
      preview_sha256: hash,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    })
    .select("id")
    .single()
  if (approval.error || !approval.data) {
    return { kind: "error", code: "write_failed", summary }
  }
  const approvalId = String((approval.data as { id: string }).id)
  await audit({
    userId: ctx.user.id,
    actor: "agente",
    action: "approval.requested",
    targetType: "approval",
    targetId: approvalId,
    details: { kind: "enviar_email" },
  })

  return {
    kind: "email_approval",
    approvalId,
    draftId: row.id,
    preview,
    summary,
  }
}

export async function toolSendEmail(
  ctx: UserContext,
  approvalId: string,
  summary: string
): Promise<ChatToolOutput> {
  const result = await decideApproval(ctx, {
    approvalId,
    approve: true,
    via: "web",
  })
  if (!result.ok) {
    return { kind: "error", code: result.code, summary: result.message }
  }
  return { kind: "email_sent", approvalId, summary }
}
