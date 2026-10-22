import "server-only"

import { sendGmailMessage } from "@vagapilot/gmail"
import { GMAIL_SEND_SCOPE } from "@vagapilot/gmail"

import { assertFeatureEnabled, incrementUsage } from "@/lib/entitlements/server"
import { getGmailRuntime } from "@/lib/gmail/runtime"
import { audit } from "@/lib/server/audit"
import type { UserContext } from "@/lib/server/context"
import { getAdminClient } from "@/lib/server/admin"
import { getFieldCrypto } from "@/lib/server/field-crypto"

import type { ApprovalDecisionResult } from "@/lib/approvals/decide"

export async function executeApprovedEmailSend(
  ctx: UserContext,
  approvalId: string
): Promise<ApprovalDecisionResult> {
  try {
    await assertFeatureEnabled(ctx.user.id, "emailApplications")
    await incrementUsage(ctx.user.id, "emails_sent", 1)
  } catch {
    return {
      ok: false,
      code: "feature_denied",
      message: "E-mail applications are not available on your plan.",
    }
  }

  const approval = await ctx.supabase
    .from("approvals")
    .select("subject_ref, application_id")
    .eq("id", approvalId)
    .eq("user_id", ctx.user.id)
    .maybeSingle()
  const draftId = String(
    (approval.data as { subject_ref?: { draft_id?: string } } | null)
      ?.subject_ref?.draft_id ?? ""
  )
  if (!draftId) {
    return { ok: false, code: "not_found", message: "Draft not linked." }
  }

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
    status: string
  } | null
  if (!row) return { ok: false, code: "not_found", message: "Draft not found." }
  if (row.status === "enviado") {
    return { ok: false, code: "conflict", message: "Draft already sent." }
  }

  const runtime = getGmailRuntime()
  if (!runtime) {
    return {
      ok: false,
      code: "not_configured",
      message: "Gmail is not configured.",
    }
  }
  const connection = await runtime.store.getConnection(ctx.user.id)
  if (!connection?.scopes.includes(GMAIL_SEND_SCOPE)) {
    return { ok: false, code: "conflict", message: "Gmail send scope missing." }
  }

  const crypto = getFieldCrypto()
  const tokenSealed = await runtime.store.readRefreshToken(ctx.user.id)
  if (!tokenSealed) {
    return { ok: false, code: "conflict", message: "Gmail token missing." }
  }
  const refreshToken = await crypto.decryptFieldText(ctx.user.id, tokenSealed)
  const access = await runtime.oauth!.refreshAccessToken(refreshToken)

  let attachment:
    { filename: string; mimeType: string; data: Uint8Array } | undefined
  if (row.attachment_cv_version_id) {
    const admin = getAdminClient()
    const cv = await admin
      ?.from("cv_versions")
      .select("storage_path, language, label")
      .eq("id", row.attachment_cv_version_id)
      .eq("user_id", ctx.user.id)
      .maybeSingle()
    const cvRow = cv?.data as { storage_path: string } | null
    if (cvRow?.storage_path && admin) {
      const { data: file } = await admin.storage
        .from("cvs")
        .download(cvRow.storage_path)
      if (file) {
        const buffer = new Uint8Array(await file.arrayBuffer())
        attachment = {
          filename: "CV.pdf",
          mimeType: "application/pdf",
          data: buffer,
        }
      }
    }
  }

  const sent = await sendGmailMessage(async () => access.accessToken, {
    from: connection.googleEmail,
    to: row.to_addresses,
    cc: row.cc_addresses ?? [],
    subject: row.subject,
    bodyText: row.body_md,
    attachment,
  })

  const sentAt = new Date().toISOString()
  await ctx.supabase
    .from("email_drafts")
    .update({
      status: "enviado",
      gmail_message_id: sent.id,
      gmail_thread_id: sent.threadId,
      sent_at: sentAt,
    })
    .eq("id", row.id)
    .eq("user_id", ctx.user.id)

  if (row.application_id) {
    await ctx.supabase
      .from("applications")
      .update({ status: "enviada", applied_at: sentAt, route: "email" })
      .eq("id", row.application_id)
      .eq("user_id", ctx.user.id)
  }

  await audit({
    userId: ctx.user.id,
    actor: "usuario",
    action: "email.sent",
    targetType: "email_draft",
    targetId: row.id,
    approvalId,
    details: { via: "gmail" },
  })

  return { ok: true, status: "aprovada" }
}
