import "server-only"

import { createHash, randomUUID } from "node:crypto"

import { assertCvAppendOnly } from "@vagapilot/core/cv-structure"
import { computeAtsScore } from "@vagapilot/core/ats-score"

import { linkChatRecord } from "@/lib/chat/record-links"
import type { ChatToolOutput } from "@/lib/chat/types"
import { audit } from "@/lib/server/audit"
import type { UserContext } from "@/lib/server/context"

export const HYBRID_TRACK_NAME = "Híbrido"

export async function toolAtsScore(
  ctx: UserContext,
  input: { cvVersionId: string; jobPostingId: string; jobMatchId?: string },
  summary: string
): Promise<ChatToolOutput> {
  const [cv, posting, match] = await Promise.all([
    ctx.supabase
      .from("cv_versions")
      .select("extracted_text")
      .eq("id", input.cvVersionId)
      .eq("user_id", ctx.user.id)
      .maybeSingle(),
    ctx.supabase
      .from("job_postings")
      .select("requirements_required, requirements_preferred")
      .eq("id", input.jobPostingId)
      .maybeSingle(),
    input.jobMatchId
      ? ctx.supabase
          .from("job_matches")
          .select("id, ats")
          .eq("id", input.jobMatchId)
          .eq("user_id", ctx.user.id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])
  const cvText = (cv.data as { extracted_text: string | null } | null)
    ?.extracted_text
  if (!cvText) {
    return {
      kind: "error",
      code: "not_ready",
      summary: "CV ainda processando.",
    }
  }
  const req = posting.data as {
    requirements_required: string[] | null
    requirements_preferred: string[] | null
  } | null
  const requirements = [
    ...(req?.requirements_required ?? []),
    ...(req?.requirements_preferred ?? []),
  ]
  const before = computeAtsScore({ cvText, requirements })
  const atsPayload = { before: before.score, after: null, keywords: before }
  if (input.jobMatchId && match.data) {
    await ctx.supabase
      .from("job_matches")
      .update({ ats: atsPayload })
      .eq("id", input.jobMatchId)
      .eq("user_id", ctx.user.id)
  }
  return {
    kind: "ats_score",
    jobMatchId: input.jobMatchId ?? input.jobPostingId,
    before: before.score,
    after: null,
    covered: before.covered,
    missing: before.missing,
    summary,
  }
}

export async function toolProposeCvAdjustment(
  ctx: UserContext,
  input: {
    cvVersionId: string
    jobPostingId: string
    trackId?: string
    conversationId: string
  },
  summary: string
): Promise<ChatToolOutput> {
  const version = await ctx.supabase
    .from("cv_versions")
    .select("id, label, extracted_text, track_id")
    .eq("id", input.cvVersionId)
    .eq("user_id", ctx.user.id)
    .maybeSingle()
  const row = version.data as {
    id: string
    label: string
    extracted_text: string | null
    track_id: string | null
  } | null
  if (!row?.extracted_text) {
    return { kind: "error", code: "not_ready", summary }
  }
  const { data: facts } = await ctx.supabase
    .from("confirmed_facts")
    .select("id, statement")
    .eq("user_id", ctx.user.id)
    .eq("status", "confirmado")
    .eq("usage", "cv_relevant")
    .limit(8)
  const factRows = (facts ?? []) as { id: string; statement: string }[]
  if (factRows.length === 0) {
    return {
      kind: "error",
      code: "no_facts",
      summary: "Preciso de fatos confirmados para ajustar o CV.",
    }
  }
  const additions = factRows.map((f) => `- ${f.statement}`)
  const factIds = factRows.map((f) => f.id)
  const nextText = `${row.extracted_text.trim()}\n\n## Destaques para a vaga\n${additions.join("\n")}`
  const check = assertCvAppendOnly({
    parentText: row.extracted_text,
    nextText,
  })
  if (!check.ok) {
    return { kind: "error", code: check.code, summary: "Ajuste inválido." }
  }
  const posting = await ctx.supabase
    .from("job_postings")
    .select("requirements_required, requirements_preferred")
    .eq("id", input.jobPostingId)
    .maybeSingle()
  const requirements = [
    ...((posting.data as { requirements_required: string[] | null } | null)
      ?.requirements_required ?? []),
    ...((posting.data as { requirements_preferred: string[] | null } | null)
      ?.requirements_preferred ?? []),
  ]
  const before = computeAtsScore({ cvText: row.extracted_text, requirements })
  const after = computeAtsScore({ cvText: nextText, requirements })
  const preview = {
    parentVersionId: row.id,
    trackId: input.trackId ?? row.track_id,
    additions,
    factIds,
    nextText,
    beforeScore: before.score,
    afterScore: after.score,
  }
  const approval = await ctx.supabase
    .from("approvals")
    .insert({
      user_id: ctx.user.id,
      kind: "cv_change",
      subject_ref: {
        cv_version_id: row.id,
        job_posting_id: input.jobPostingId,
        conversation_id: input.conversationId,
      },
      preview,
      preview_sha256: createHash("sha256")
        .update(JSON.stringify(preview))
        .digest("hex"),
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    })
    .select("id")
    .single()
  if (approval.error || !approval.data) {
    return { kind: "error", code: "write_failed", summary }
  }
  const approvalId = String((approval.data as { id: string }).id)
  return {
    kind: "cv_diff",
    approvalId,
    trackLabel: row.label,
    additions,
    beforeScore: before.score,
    afterScore: after.score,
    summary,
  }
}

export async function toolApplyCvAdjustment(
  ctx: UserContext,
  approvalId: string,
  conversationId: string,
  summary: string
): Promise<ChatToolOutput> {
  const { verifyApprovalForApply } = await import("@/lib/approvals/apply")
  const gate = await verifyApprovalForApply(ctx, approvalId, "cv_change")
  if (!gate.ok) {
    return { kind: "error", code: gate.code, summary: gate.message }
  }
  const preview = gate.preview as {
    parentVersionId: string
    trackId: string | null
    nextText: string
    factIds: string[]
  }
  const parent = await ctx.supabase
    .from("cv_versions")
    .select("language, label, storage_path")
    .eq("id", preview.parentVersionId)
    .eq("user_id", ctx.user.id)
    .maybeSingle()
  if (!parent.data) {
    return { kind: "error", code: "not_found", summary }
  }
  const id = randomUUID()
  const path = `${ctx.user.id}/${id}.txt`
  const bytes = new TextEncoder().encode(preview.nextText)
  await ctx.supabase.storage.from("cvs").upload(path, bytes, {
    contentType: "text/plain",
    upsert: false,
  })
  await ctx.supabase.from("cv_versions").insert({
    id,
    user_id: ctx.user.id,
    track_id: preview.trackId,
    language: (parent.data as { language: string }).language,
    label: `${(parent.data as { label: string }).label} (ajuste chat)`,
    storage_path: path,
    file_sha256: createHash("sha256").update(bytes).digest("hex"),
    origin: "chat",
    parent_version_id: preview.parentVersionId,
    extracted_text: preview.nextText,
    fact_ids: preview.factIds,
  })
  await linkChatRecord(ctx, {
    conversationId,
    tableName: "cv_versions",
    recordId: id,
    action: "created",
  })
  await audit({
    userId: ctx.user.id,
    actor: "usuario",
    action: "cv.generated",
    targetType: "cv_version",
    targetId: id,
    approvalId,
  })
  return {
    kind: "deep_link",
    href: `/app/cvs?version=${id}`,
    label: "CV ajustado",
    summary,
  }
}

export async function ensureHybridTrack(
  ctx: UserContext
): Promise<{ trackId: string }> {
  const existing = await ctx.supabase
    .from("cv_tracks")
    .select("id")
    .eq("user_id", ctx.user.id)
    .eq("name", HYBRID_TRACK_NAME)
    .maybeSingle()
  if (existing.data) {
    return { trackId: (existing.data as { id: string }).id }
  }
  const created = await ctx.supabase
    .from("cv_tracks")
    .insert({
      user_id: ctx.user.id,
      name: HYBRID_TRACK_NAME,
      description: "União do conteúdo cv_relevant das demais trilhas.",
    })
    .select("id")
    .single()
  if (created.error || !created.data) {
    throw new Error(created.error?.message ?? "hybrid track failed")
  }
  return { trackId: (created.data as { id: string }).id }
}
