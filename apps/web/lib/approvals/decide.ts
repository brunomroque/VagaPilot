import "server-only"

import { createHash } from "node:crypto"

import { createEmbedder } from "@vagapilot/ai"
import { hashEmailDraftSnapshot } from "@vagapilot/core/application-email"

import { executeApprovedEmailSend } from "@/lib/email/send-approved"
import { audit } from "@/lib/server/audit"
import type { UserContext } from "@/lib/server/context"

export type ApprovalDecisionResult =
  | { ok: true; status: "aprovada" | "rejeitada" }
  | { ok: false; code: string; message: string }

type ApprovalRow = {
  id: string
  kind: string
  status: string
  subject_ref: Record<string, unknown>
  preview: Record<string, unknown>
  preview_sha256: string
  expires_at: string
}

export async function decideApproval(
  ctx: UserContext,
  input: {
    approvalId: string
    approve: boolean
    via?: "web" | "extensao" | "email"
  }
): Promise<ApprovalDecisionResult> {
  const approval = await ctx.supabase
    .from("approvals")
    .select(
      "id, kind, status, subject_ref, preview, preview_sha256, expires_at"
    )
    .eq("id", input.approvalId)
    .eq("user_id", ctx.user.id)
    .maybeSingle()
  const row = approval.data as ApprovalRow | null
  if (!row)
    return { ok: false, code: "not_found", message: "Approval not found." }
  if (row.status !== "pendente") {
    return { ok: false, code: "conflict", message: "Already decided." }
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await ctx.supabase
      .from("approvals")
      .update({ status: "expirada" })
      .eq("id", row.id)
      .eq("user_id", ctx.user.id)
    return { ok: false, code: "conflict", message: "Approval expired." }
  }

  const hashOk = await verifyApprovalHash(ctx, row)
  if (!hashOk.ok) return hashOk

  const decidedAt = new Date().toISOString()
  const status = input.approve ? "aprovada" : "rejeitada"

  if (input.approve && row.kind === "enviar_email") {
    const sent = await executeApprovedEmailSend(ctx, row.id)
    if (!sent.ok) return sent
  }

  if (row.kind === "criar_fato") {
    const factId = String(row.subject_ref.fact_id ?? "")
    const fact = await ctx.supabase
      .from("confirmed_facts")
      .select("id, statement, kind")
      .eq("id", factId)
      .eq("user_id", ctx.user.id)
      .maybeSingle()
    const factRow = fact.data as {
      id: string
      statement: string
      kind: string
    } | null
    if (!factRow)
      return { ok: false, code: "not_found", message: "Fact not found." }
    if (input.approve) {
      const embedding = await createEmbedder().embed(factRow.statement)
      await ctx.supabase
        .from("confirmed_facts")
        .update({
          status: "confirmado",
          confirmed_at: decidedAt,
          embedding: JSON.stringify(embedding),
        })
        .eq("id", factRow.id)
        .eq("user_id", ctx.user.id)
      await audit({
        userId: ctx.user.id,
        actor: "usuario",
        action: "fact.confirmed",
        targetType: "confirmed_fact",
        targetId: factRow.id,
        approvalId: row.id,
        details: { source: "approval_api" },
      })
    } else {
      await ctx.supabase
        .from("confirmed_facts")
        .update({ status: "rejeitado" })
        .eq("id", factRow.id)
        .eq("user_id", ctx.user.id)
    }
  }

  await ctx.supabase
    .from("approvals")
    .update({
      status,
      decided_at: decidedAt,
      decided_via: input.via ?? "web",
    })
    .eq("id", row.id)
    .eq("user_id", ctx.user.id)

  if (input.approve && row.kind === "cv_change") {
    const conversationId = String(row.subject_ref.conversation_id ?? "")
    if (conversationId) {
      const { toolApplyCvAdjustment } = await import("@/lib/cvs/chat-cv")
      await toolApplyCvAdjustment(ctx, row.id, conversationId, "CV ajustado.")
    }
  }

  await audit({
    userId: ctx.user.id,
    actor: "usuario",
    action: input.approve ? "approval.approved" : "approval.rejected",
    targetType: "approval",
    targetId: row.id,
    details: { kind: row.kind },
  })

  return { ok: true, status }
}

async function verifyApprovalHash(
  ctx: UserContext,
  row: ApprovalRow
): Promise<ApprovalDecisionResult | { ok: true }> {
  switch (row.kind) {
    case "criar_fato": {
      const factId = String(row.subject_ref.fact_id ?? "")
      const fact = await ctx.supabase
        .from("confirmed_facts")
        .select("statement, kind")
        .eq("id", factId)
        .eq("user_id", ctx.user.id)
        .maybeSingle()
      const factRow = fact.data as { statement: string; kind: string } | null
      if (!factRow) {
        return { ok: false, code: "not_found", message: "Fact not found." }
      }
      const hash = createHash("sha256")
        .update(
          JSON.stringify({ statement: factRow.statement, kind: factRow.kind })
        )
        .digest("hex")
      if (hash !== row.preview_sha256) {
        return {
          ok: false,
          code: "conflict",
          message: "Content changed after the request.",
        }
      }
      return { ok: true }
    }
    case "enviar_email": {
      const draftId = String(row.subject_ref.draft_id ?? "")
      const draft = await ctx.supabase
        .from("email_drafts")
        .select(
          "to_addresses, cc_addresses, subject, body_md, attachment_cv_version_id, status"
        )
        .eq("id", draftId)
        .eq("user_id", ctx.user.id)
        .maybeSingle()
      const d = draft.data as {
        to_addresses: string[]
        cc_addresses: string[] | null
        subject: string
        body_md: string
        attachment_cv_version_id: string | null
        status: string
      } | null
      if (!d || d.status === "enviado") {
        return {
          ok: false,
          code: "conflict",
          message: "Draft is no longer valid.",
        }
      }
      const hash = hashEmailDraftSnapshot({
        to: d.to_addresses,
        cc: d.cc_addresses ?? [],
        subject: d.subject,
        bodyMd: d.body_md,
        attachmentCvVersionId: d.attachment_cv_version_id,
      })
      if (hash !== row.preview_sha256) {
        return {
          ok: false,
          code: "conflict",
          message: "Draft changed after the request.",
        }
      }
      return { ok: true }
    }
    default:
      return { ok: true }
  }
}
