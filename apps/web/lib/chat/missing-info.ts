import "server-only"

import { createEmbedder } from "@vagapilot/ai"

import { toolProposeCvAdjustment } from "@/lib/cvs/chat-cv"
import { linkChatRecord } from "@/lib/chat/record-links"
import type { ChatToolOutput } from "@/lib/chat/types"
import { audit } from "@/lib/server/audit"
import type { UserContext } from "@/lib/server/context"

export type FactDestination =
  "application_only" | "save_fact" | "update_cvs" | "register_gap"

export async function applyFactDestination(
  ctx: UserContext,
  input: {
    conversationId: string
    pendingQuestionId: string
    destination: FactDestination
    statement: string
    suggestedUsage: "cv_relevant" | "form_only"
  }
): Promise<ChatToolOutput> {
  const question = await ctx.supabase
    .from("pending_questions")
    .select("id, question_text, application_id, status")
    .eq("id", input.pendingQuestionId)
    .eq("user_id", ctx.user.id)
    .maybeSingle()
  const row = question.data as {
    id: string
    question_text: string
    application_id: string | null
    status: string
  } | null
  if (!row) {
    return {
      kind: "error",
      code: "not_found",
      summary: "Pergunta não encontrada.",
    }
  }
  if (row.status !== "aberta") {
    return {
      kind: "error",
      code: "conflict",
      summary: "Esta pergunta já foi respondida.",
    }
  }

  switch (input.destination) {
    case "application_only": {
      await ctx.supabase
        .from("pending_questions")
        .update({
          answer: input.statement.trim(),
          remember: false,
          status: "respondida",
          answered_at: new Date().toISOString(),
        })
        .eq("id", row.id)
        .eq("user_id", ctx.user.id)
      await audit({
        userId: ctx.user.id,
        actor: "usuario",
        action: "question.answered",
        targetType: "pending_question",
        targetId: row.id,
        details: { destination: input.destination, remember: false },
      })
      return {
        kind: "deep_link",
        href: row.application_id
          ? `/app/candidaturas?id=${row.application_id}`
          : "/app/candidaturas",
        label: "Candidatura",
        summary: "Resposta salva só nesta candidatura.",
      }
    }
    case "save_fact": {
      const fact = await ctx.supabase
        .from("confirmed_facts")
        .insert({
          user_id: ctx.user.id,
          statement: input.statement.trim(),
          kind: "competencia",
          status: "confirmado",
          usage: input.suggestedUsage,
          source: "chat",
          source_ref: {
            via: "answer_missing_info",
            pending_question_id: row.id,
          },
          confirmed_at: new Date().toISOString(),
        })
        .select("id")
        .single()
      if (fact.error || !fact.data) {
        return {
          kind: "error",
          code: "write_failed",
          summary: "Não foi possível salvar o fato.",
        }
      }
      const factId = String((fact.data as { id: string }).id)
      const embedding = await createEmbedder().embed(input.statement.trim())
      await ctx.supabase
        .from("confirmed_facts")
        .update({ embedding: JSON.stringify(embedding) })
        .eq("id", factId)
        .eq("user_id", ctx.user.id)
      await linkChatRecord(ctx, {
        conversationId: input.conversationId,
        tableName: "confirmed_facts",
        recordId: factId,
        action: "created",
      })
      await ctx.supabase
        .from("pending_questions")
        .update({
          answer: input.statement.trim(),
          remember: true,
          status: "respondida",
          answered_at: new Date().toISOString(),
        })
        .eq("id", row.id)
        .eq("user_id", ctx.user.id)
      if (input.suggestedUsage === "cv_relevant") {
        await ctx.supabase.from("platform_profiles").upsert(
          {
            user_id: ctx.user.id,
            platform: "linkedin",
            outdated: true,
            outdated_reason: "Novo fato cv_relevant confirmado.",
          },
          { onConflict: "user_id,platform" }
        )
      }
      await audit({
        userId: ctx.user.id,
        actor: "usuario",
        action: "fact.confirmed",
        targetType: "confirmed_fact",
        targetId: factId,
        details: { source: "fact_destination", usage: input.suggestedUsage },
      })
      return {
        kind: "deep_link",
        href: `/app/fatos?id=${factId}`,
        label: "Fato salvo",
        summary: "Fato reutilizável salvo na sua base.",
      }
    }
    case "update_cvs": {
      if (input.suggestedUsage !== "cv_relevant") {
        return {
          kind: "error",
          code: "denied",
          summary: "Só fatos relevantes para CV podem atualizar currículos.",
        }
      }
      if (!row.application_id) {
        return {
          kind: "error",
          code: "not_found",
          summary: "Não há candidatura ligada a esta pergunta.",
        }
      }
      const application = await ctx.supabase
        .from("applications")
        .select("job_match_id, cv_version_id")
        .eq("id", row.application_id)
        .eq("user_id", ctx.user.id)
        .maybeSingle()
      const app = application.data as {
        job_match_id: string
        cv_version_id: string | null
      } | null
      if (!app?.job_match_id) {
        return {
          kind: "error",
          code: "not_found",
          summary: "Candidatura não encontrada.",
        }
      }
      const match = await ctx.supabase
        .from("job_matches")
        .select("job_posting_id, recommended_cv_version_id")
        .eq("id", app.job_match_id)
        .eq("user_id", ctx.user.id)
        .maybeSingle()
      const matchRow = match.data as {
        job_posting_id: string
        recommended_cv_version_id: string | null
      } | null
      const cvVersionId =
        app.cv_version_id ?? matchRow?.recommended_cv_version_id ?? null
      if (!matchRow?.job_posting_id || !cvVersionId) {
        return {
          kind: "error",
          code: "not_found",
          summary: "CV ou vaga não encontrados para propor ajuste.",
        }
      }
      await ctx.supabase
        .from("pending_questions")
        .update({
          answer: input.statement.trim(),
          remember: true,
          status: "respondida",
          answered_at: new Date().toISOString(),
        })
        .eq("id", row.id)
        .eq("user_id", ctx.user.id)
      return toolProposeCvAdjustment(
        ctx,
        {
          cvVersionId,
          jobPostingId: matchRow.job_posting_id,
          conversationId: input.conversationId,
        },
        "Proposta de ajuste de CV."
      )
    }
    case "register_gap": {
      const memory = await ctx.supabase
        .from("memory_events")
        .insert({
          user_id: ctx.user.id,
          intent: "gap",
          origin: "chat",
          utterance: row.question_text.slice(0, 2000),
          target_type: "pending_question",
          target_id: row.id,
          before: null,
          after: {
            statement: input.statement.trim(),
            question: row.question_text,
          },
          status: "aplicada",
          conversation_id: input.conversationId,
          decided_at: new Date().toISOString(),
        })
        .select("id")
        .single()
      if (memory.error || !memory.data) {
        return {
          kind: "error",
          code: "write_failed",
          summary: "Não foi possível registrar a lacuna.",
        }
      }
      const memoryId = String((memory.data as { id: string }).id)
      await linkChatRecord(ctx, {
        conversationId: input.conversationId,
        tableName: "memory_events",
        recordId: memoryId,
        action: "created",
      })
      await ctx.supabase
        .from("pending_questions")
        .update({
          answer: "[lacuna confirmada]",
          remember: false,
          status: "respondida",
          answered_at: new Date().toISOString(),
        })
        .eq("id", row.id)
        .eq("user_id", ctx.user.id)
      await audit({
        userId: ctx.user.id,
        actor: "usuario",
        action: "question.answered",
        targetType: "memory_event",
        targetId: memoryId,
        details: { intent: "gap", pending_question_id: row.id },
      })
      return {
        kind: "deep_link",
        href: "/app/memoria",
        label: "Memória",
        summary: "Lacuna registrada — não vou afirmar essa experiência.",
      }
    }
    default: {
      const unreachable: never = input.destination
      throw new Error(`Unknown destination: ${String(unreachable)}`)
    }
  }
}
