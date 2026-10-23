"use server"

import { redirect } from "next/navigation"
import { z } from "zod"

import { MAX_CHAT_INPUT_CHARS } from "@vagapilot/core/guardrails"

import { fail, ok, type ActionResult } from "@/lib/action-result"
import { createConversation } from "@/lib/chat/conversations"
import {
  analyzeAnyway,
  loadBatch,
  loadJobCards,
  recordDecision,
  startIngestion,
  type DecisionResult,
} from "@/lib/chat/jobs-server"
import type {
  IngestItem,
  JobCardData,
  SettingsChangeOutput,
} from "@/lib/chat/types"
import { audit } from "@/lib/server/audit"
import { getUserContext, type UserContext } from "@/lib/server/context"
import {
  cancelPendingChange,
  confirmPendingChange,
  undoMemoryEvent,
} from "@/lib/settings/server"

/*
 * Widget buttons call these server actions, never the LLM (F7 RF7.2, CA7.1). Each one checks
 * the session, validates with Zod and verifies ownership of every referenced row.
 */

async function session(): Promise<
  { ctx: UserContext } | { error: ActionResult<never> }
> {
  const result = await getUserContext()
  if (!result.ok)
    return { error: fail(result.error.code, result.error.message) }
  return { ctx: result.ctx }
}

const uuid = z.uuid()

export async function loadBatchAction(
  input: unknown
): Promise<ActionResult<{ items: IngestItem[]; cards: JobCardData[] }>> {
  const parsed = z.object({ batchId: uuid }).safeParse(input)
  if (!parsed.success) return fail("invalid_request", "Invalid batch.")
  const auth = await session()
  if ("error" in auth) return auth.error
  const items = await loadBatch(auth.ctx, parsed.data.batchId)
  const matchIds = items
    .map((item) => item.jobMatchId)
    .filter((id): id is string => Boolean(id))
  return ok({ items, cards: await loadJobCards(auth.ctx, matchIds) })
}

export async function loadCardsAction(
  input: unknown
): Promise<ActionResult<JobCardData[]>> {
  const parsed = z.object({ matchIds: z.array(uuid).max(20) }).safeParse(input)
  if (!parsed.success) return fail("invalid_request", "Invalid cards.")
  const auth = await session()
  if ("error" in auth) return auth.error
  return ok(await loadJobCards(auth.ctx, parsed.data.matchIds))
}

export async function decideJobAction(
  input: unknown
): Promise<ActionResult<DecisionResult>> {
  const parsed = z
    .object({
      matchId: uuid,
      decision: z.enum(["aplicar", "pular", "salvar"]),
      reason: z.string().trim().max(300).nullish(),
    })
    .safeParse(input)
  if (!parsed.success) return fail("invalid_request", "Invalid decision.")
  const auth = await session()
  if ("error" in auth) return auth.error
  try {
    return ok(
      await recordDecision(auth.ctx, {
        matchId: parsed.data.matchId,
        decision: parsed.data.decision,
        reason: parsed.data.reason ?? null,
        source: "usuario",
      })
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : ""
    if (message === "not_found") return fail("not_found", "Job not found.")
    if (message.startsWith("invalid_transition"))
      return fail("conflict", message)
    console.error("decision failed", { reason: message })
    return fail("internal_error", "Could not record the decision.")
  }
}

export async function changeCvAction(
  input: unknown
): Promise<ActionResult<JobCardData | null>> {
  const parsed = z.object({ matchId: uuid, cvVersionId: uuid }).safeParse(input)
  if (!parsed.success) return fail("invalid_request", "Invalid CV.")
  const auth = await session()
  if ("error" in auth) return auth.error
  const { ctx } = auth
  const cv = await ctx.supabase
    .from("cv_versions")
    .select("id")
    .eq("id", parsed.data.cvVersionId)
    .eq("user_id", ctx.user.id)
    .maybeSingle()
  if (!cv.data) return fail("not_found", "CV not found.")
  const { data, error } = await ctx.supabase
    .from("job_matches")
    .update({ recommended_cv_version_id: parsed.data.cvVersionId })
    .eq("id", parsed.data.matchId)
    .eq("user_id", ctx.user.id)
    .select("id")
    .maybeSingle()
  if (error) return fail("internal_error", "Could not change the CV.")
  if (!data) return fail("not_found", "Job not found.")
  const [card] = await loadJobCards(ctx, [parsed.data.matchId])
  return ok(card ?? null)
}

export async function adjustSalaryAction(
  input: unknown
): Promise<ActionResult<JobCardData | null>> {
  const parsed = z
    .object({ matchId: uuid, amount: z.number().positive().max(10_000_000) })
    .safeParse(input)
  if (!parsed.success) return fail("invalid_request", "Invalid amount.")
  const auth = await session()
  if ("error" in auth) return auth.error
  const { ctx } = auth
  const current = await ctx.supabase
    .from("job_matches")
    .select("suggested_salary")
    .eq("id", parsed.data.matchId)
    .eq("user_id", ctx.user.id)
    .maybeSingle()
  if (!current.data) return fail("not_found", "Job not found.")
  const salary = ((
    current.data as { suggested_salary: Record<string, unknown> | null }
  ).suggested_salary ?? {}) as Record<string, unknown>
  const { error } = await ctx.supabase
    .from("job_matches")
    .update({ suggested_salary: { ...salary, override: parsed.data.amount } })
    .eq("id", parsed.data.matchId)
    .eq("user_id", ctx.user.id)
  if (error) return fail("internal_error", "Could not save the amount.")
  const [card] = await loadJobCards(ctx, [parsed.data.matchId])
  return ok(card ?? null)
}

export async function analyzeAnywayAction(
  input: unknown
): Promise<ActionResult<JobCardData | null>> {
  const parsed = z.object({ matchId: uuid }).safeParse(input)
  if (!parsed.success) return fail("invalid_request", "Invalid job.")
  const auth = await session()
  if ("error" in auth) return auth.error
  try {
    await analyzeAnyway(auth.ctx, parsed.data.matchId)
  } catch {
    return fail("not_found", "Job not found.")
  }
  const [card] = await loadJobCards(auth.ctx, [parsed.data.matchId])
  return ok(card ?? null)
}

/** CA4.2: the pasted description replaces a link that could not be read. */
export async function retryWithTextAction(
  input: unknown
): Promise<ActionResult<{ batchId: string; items: IngestItem[] }>> {
  const parsed = z
    .object({
      ingestionId: uuid,
      text: z.string().trim().min(30).max(MAX_CHAT_INPUT_CHARS),
    })
    .safeParse(input)
  if (!parsed.success)
    return fail(
      "invalid_request",
      "Paste at least a few lines of the job description."
    )
  const auth = await session()
  if ("error" in auth) return auth.error
  const { ctx } = auth
  const { data } = await ctx.supabase
    .from("job_ingestions")
    .select("input_url, conversation_id")
    .eq("id", parsed.data.ingestionId)
    .eq("user_id", ctx.user.id)
    .maybeSingle()
  const row = data as {
    input_url: string | null
    conversation_id: string | null
  } | null
  if (!row) return fail("not_found", "Ingestion not found.")
  return ok(
    await startIngestion(ctx, {
      text: parsed.data.text,
      replaceUrl: row.input_url,
      conversationId: row.conversation_id,
    })
  )
}

export async function undoChangeAction(
  input: unknown
): Promise<ActionResult<SettingsChangeOutput>> {
  const parsed = z.object({ memoryEventId: uuid }).safeParse(input)
  if (!parsed.success) return fail("invalid_request", "Invalid change.")
  const auth = await session()
  if ("error" in auth) return auth.error
  return ok(await undoMemoryEvent(auth.ctx, parsed.data.memoryEventId))
}

export async function confirmChangeAction(
  input: unknown
): Promise<ActionResult<SettingsChangeOutput>> {
  const parsed = z.object({ memoryEventId: uuid }).safeParse(input)
  if (!parsed.success) return fail("invalid_request", "Invalid change.")
  const auth = await session()
  if ("error" in auth) return auth.error
  return ok(await confirmPendingChange(auth.ctx, parsed.data.memoryEventId))
}

export async function cancelChangeAction(
  input: unknown
): Promise<ActionResult<SettingsChangeOutput>> {
  const parsed = z.object({ memoryEventId: uuid }).safeParse(input)
  if (!parsed.success) return fail("invalid_request", "Invalid change.")
  const auth = await session()
  if ("error" in auth) return auth.error
  return ok(await cancelPendingChange(auth.ctx, parsed.data.memoryEventId))
}

/**
 * ApprovalCard of `propose_fact`: confirms (or rejects) the proposed fact if the approval is
 * pending, not expired and its preview hash still matches the fact (10.1 principle 2).
 */
export async function decideApprovalAction(
  input: unknown
): Promise<ActionResult<{ status: "aprovada" | "rejeitada" }>> {
  return decideFactAction(input)
}

export async function decideFactAction(
  input: unknown
): Promise<ActionResult<{ status: "aprovada" | "rejeitada" }>> {
  const parsed = z
    .object({ approvalId: uuid, approve: z.boolean() })
    .safeParse(input)
  if (!parsed.success) return fail("invalid_request", "Invalid approval.")
  const auth = await session()
  if ("error" in auth) return auth.error
  const { decideApproval } = await import("@/lib/approvals/decide")
  const result = await decideApproval(auth.ctx, {
    approvalId: parsed.data.approvalId,
    approve: parsed.data.approve,
    via: "web",
  })
  if (!result.ok) {
    const code =
      result.code === "not_found"
        ? "not_found"
        : result.code === "conflict"
          ? "conflict"
          : "invalid_request"
    return fail(code, result.message)
  }
  return ok({ status: result.status })
}

const answerQuestionSchema = z.object({
  questionId: z.uuid(),
  answer: z.string().min(1).max(4000),
  remember: z.boolean().optional(),
  /** Category grant for "Sempre permitir neste site" (permission cards). */
  grant: z
    .object({
      categories: z.array(z.string().max(40)).max(20),
      acknowledged: z.boolean(),
      sensitiveConfirmation: z.string().max(80).nullable().optional(),
    })
    .optional(),
})

export async function answerPendingQuestionAction(
  input: unknown
): Promise<ActionResult<{ id: string }>> {
  const parsed = answerQuestionSchema.safeParse(input)
  if (!parsed.success) return fail("invalid_request", "Invalid answer.")
  const auth = await session()
  if ("error" in auth) return auth.error
  const { consentMeta } = await import("@/lib/legal/server")
  const { CONSENT_ACCEPT, CONSENT_CANCEL } = await import("@vagapilot/browser-pool/apply")
  const current = await auth.ctx.supabase
    .from("pending_questions")
    .select("question_text, proposed_from")
    .eq("id", parsed.data.questionId)
    .eq("user_id", auth.ctx.user.id)
    .maybeSingle()
  const currentRow = current.data as { question_text: string; proposed_from: unknown } | null
  const consent = consentMeta(currentRow?.proposed_from)
  const pf = (currentRow?.proposed_from ?? null) as
    | { permission?: boolean; action?: string; host?: string; categories?: string[]; missing?: string[] }
    | null
  const isPermission = pf?.permission === true
  let answer = parsed.data.answer.trim()
  const { cardChoiceFor } = await import("@vagapilot/core/permissions")
  const choice = consent || isPermission ? cardChoiceFor(answer) : null
  if (choice) {
    // Run card: "Sempre ..." persists a site rule (allow requires the category grant).
    const { applyCardChoice } = await import("@/lib/permissions/server")
    const { sessionIdFromClaims } = await import("@/lib/legal/server")
    const { data: claims } = await auth.ctx.supabase.auth.getClaims()
    const applied = await applyCardChoice(
      {
        id: auth.ctx.user.id,
        email: auth.ctx.user.email,
        sessionId: sessionIdFromClaims(claims?.claims as Record<string, unknown> | undefined),
      },
      pf ?? {},
      choice,
      parsed.data.grant ?? null
    )
    if (!applied.ok) return fail("invalid_request", applied.error)
    if (choice === "always" || choice === "denyAlways")
      await audit({
        userId: auth.ctx.user.id,
        actor: "usuario",
        action: "agent_permission.changed",
        targetType: "pending_question",
        targetId: parsed.data.questionId,
        details: { choice, action: pf?.action ?? null, site: pf?.host ?? null, rule_id: applied.data.ruleId },
      }).catch(() => undefined)
    answer = isPermission
      ? applied.data.allow ? "Permitir" : "Negar"
      : applied.data.allow ? CONSENT_ACCEPT : CONSENT_CANCEL
  }
  // Terms/privacy/marketing boxes: only an explicit decision of THIS run; never remembered.
  if (consent && answer !== CONSENT_ACCEPT && answer !== CONSENT_CANCEL)
    return fail("invalid_request", "Responda Aceito ou Cancelar.")
  if (isPermission && answer !== "Permitir" && answer !== "Negar")
    return fail("invalid_request", "Responda Permitir ou Negar.")
  const { data, error } = await auth.ctx.supabase
    .from("pending_questions")
    .update({
      answer,
      status: "respondida",
      answered_at: new Date().toISOString(),
      remember: consent || isPermission ? false : (parsed.data.remember ?? false),
    })
    .eq("id", parsed.data.questionId)
    .eq("user_id", auth.ctx.user.id)
    .eq("status", "aberta")
    .select("id, application_id")
    .maybeSingle()
  if (error) return fail("internal_error", "Could not save the answer.")
  if (!data) return fail("not_found", "Question not found.")
  await audit({
    userId: auth.ctx.user.id,
    actor: "usuario",
    action: "question.answered",
    targetType: "pending_question",
    targetId: parsed.data.questionId,
    details: {
      application_id: (data as { application_id: string }).application_id,
    },
  })
  const applicationId = (data as { application_id: string | null })
    .application_id
  if (consent) {
    const decision = answer === CONSENT_ACCEPT ? "aceito" : "cancelado"
    const { recordConsentDecision } = await import("@/lib/legal/server")
    await recordConsentDecision({
      userId: auth.ctx.user.id,
      applicationId,
      questionId: parsed.data.questionId,
      fieldLabel: currentRow?.question_text ?? "",
      meta: consent,
      decision,
    })
    await audit({
      userId: auth.ctx.user.id,
      actor: "usuario",
      action: "apply.consent_decided",
      targetType: "pending_question",
      targetId: parsed.data.questionId,
      details: {
        decision,
        site: consent.site ?? null,
        terms_url: consent.terms_url ?? null,
        terms_sha256: consent.terms_sha256 ?? null,
      },
    })
    if (decision === "cancelado" && consent.run_id) {
      const { cancelApplyRun } = await import("@/lib/apply/server")
      await cancelApplyRun(auth.ctx.user.id, consent.run_id).catch(() => false)
      return ok({ id: parsed.data.questionId })
    }
  }
  if (applicationId) {
    // Cloud apply: resume the paused run once every question of this application is answered.
    const open = await auth.ctx.supabase
      .from("pending_questions")
      .select("id", { count: "exact", head: true })
      .eq("application_id", applicationId)
      .eq("user_id", auth.ctx.user.id)
      .eq("status", "aberta")
    if ((open.count ?? 0) === 0) {
      const { resumeApplyRun } = await import("@/lib/apply/server")
      await resumeApplyRun(auth.ctx.user.id, { applicationId }).catch(
        () => null
      )
    }
  }
  return ok({ id: parsed.data.questionId })
}

export async function startCloudApplyAction(
  input: unknown
): Promise<ActionResult<{ runId: string; applicationId: string }>> {
  const parsed = z.object({ matchId: uuid }).safeParse(input)
  if (!parsed.success) return fail("invalid_request", "Invalid job.")
  const auth = await session()
  if ("error" in auth) return auth.error
  try {
    const { startCloudApplication } = await import("@/lib/apply/server")
    const result = await startCloudApplication(auth.ctx, parsed.data.matchId)
    if ("error" in result) return fail("conflict", result.error)
    return ok(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : ""
    if (message === "not_found") return fail("not_found", "Job not found.")
    if (message.startsWith("invalid_transition"))
      return fail("conflict", message)
    console.error("cloud apply failed", { reason: message })
    return fail("internal_error", "Could not start the application.")
  }
}

export async function loadApplyRunAction(
  input: unknown
): Promise<ActionResult<import("@/lib/apply/server").ApplyRunView | null>> {
  const parsed = z.object({ runId: uuid }).safeParse(input)
  if (!parsed.success) return fail("invalid_request", "Invalid run.")
  const auth = await session()
  if ("error" in auth) return auth.error
  const { loadApplyRun } = await import("@/lib/apply/server")
  return ok(await loadApplyRun(auth.ctx, parsed.data.runId))
}

/** "Já fiz login / resolvi o captcha": puts the run back in the queue. */
export async function resumeApplyRunAction(
  input: unknown
): Promise<ActionResult<{ runId: string | null }>> {
  const parsed = z.object({ runId: uuid }).safeParse(input)
  if (!parsed.success) return fail("invalid_request", "Invalid run.")
  const auth = await session()
  if ("error" in auth) return auth.error
  const { resumeApplyRun } = await import("@/lib/apply/server")
  return ok({
    runId: await resumeApplyRun(auth.ctx.user.id, { runId: parsed.data.runId }),
  })
}

export async function cancelApplyRunAction(
  input: unknown
): Promise<ActionResult<{ cancelled: boolean }>> {
  const parsed = z.object({ runId: uuid }).safeParse(input)
  if (!parsed.success) return fail("invalid_request", "Invalid run.")
  const auth = await session()
  if ("error" in auth) return auth.error
  const { cancelApplyRun } = await import("@/lib/apply/server")
  return ok({
    cancelled: await cancelApplyRun(auth.ctx.user.id, parsed.data.runId),
  })
}

/** Form action, so "Nova conversa" also works before the page hydrates. */
export async function loadChatProvenanceAction(
  input: unknown
): Promise<ActionResult<{ conversationId: string } | null>> {
  const parsed = z
    .object({ tableName: z.string().min(1).max(80), recordId: uuid })
    .safeParse(input)
  if (!parsed.success) return fail("invalid_request", "Invalid record.")
  const auth = await session()
  if ("error" in auth) return auth.error
  const { findChatProvenance } = await import("@/lib/chat/record-links")
  const link = await findChatProvenance(
    auth.ctx,
    parsed.data.tableName,
    parsed.data.recordId
  )
  return ok(link ? { conversationId: link.conversationId } : null)
}

export async function startNewConversationAction(): Promise<void> {
  const auth = await session()
  if ("error" in auth) redirect("/entrar?next=/app/chat")
  const conversation = await createConversation(auth.ctx)
  redirect(`/app/chat?c=${conversation.id}`)
}

export async function archiveConversationAction(
  formData: FormData
): Promise<void> {
  const auth = await session()
  if ("error" in auth) redirect("/entrar?next=/app/chat")
  const id = String(formData.get("conversationId") ?? "")
  if (!/^[0-9a-f-]{36}$/i.test(id)) redirect("/app/chat")
  const { archiveConversation } = await import("@/lib/chat/conversations")
  await archiveConversation(auth.ctx, id)
  redirect("/app/chat")
}
