import "server-only"

import { tool, type ToolSet } from "ai"
import { getTranslations } from "next-intl/server"

import { CHAT_TOOL_DESCRIPTIONS, chatToolInputSchemas } from "@vagapilot/ai"
import {
  isAllowedNow,
  policyCheck,
  type ToolOrigin,
} from "@vagapilot/core/policy"
import type { ApplicationStatus } from "@vagapilot/core/status"

import {
  ensureHybridTrack,
  toolApplyCvAdjustment,
  toolAtsScore,
  toolProposeCvAdjustment,
} from "@/lib/cvs/chat-cv"
import { loadCvLibrary } from "@/lib/cvs/server"
import { linkChatRecord } from "@/lib/chat/record-links"
import type { ChatToolOutput } from "@/lib/chat/types"
import type { ChatTurnState } from "@/lib/chat/tools"
import type { UserContext } from "@/lib/server/context"
import { summarizeGmailThreads } from "@/lib/gmail/chat-read"

export function buildExtendedChatTools(
  ctx: UserContext,
  state: ChatTurnState
): ToolSet {
  const origin = (): ToolOrigin =>
    state.untrustedSeen ? "untrusted_content" : "user_turn"
  const t = () => getTranslations("ChatTools")

  return {
    ats_score: tool({
      description: CHAT_TOOL_DESCRIPTIONS.ats_score,
      inputSchema: chatToolInputSchemas.ats_score,
      execute: async (input): Promise<ChatToolOutput> => {
        const tr = await t()
        return toolAtsScore(ctx, input, tr("atsScore"))
      },
    }),
    propose_cv_adjustment: tool({
      description: CHAT_TOOL_DESCRIPTIONS.propose_cv_adjustment,
      inputSchema: chatToolInputSchemas.propose_cv_adjustment,
      execute: async (input): Promise<ChatToolOutput> => {
        const tr = await t()
        if (
          !isAllowedNow(
            policyCheck({ tool: "propose_cv_adjustment", origin: origin() })
          )
        ) {
          return { kind: "error", code: "denied", summary: tr("denied") }
        }
        return toolProposeCvAdjustment(
          ctx,
          {
            ...input,
            conversationId: state.conversationId,
          },
          tr("cvProposed")
        )
      },
    }),
    apply_cv_adjustment: tool({
      description: CHAT_TOOL_DESCRIPTIONS.apply_cv_adjustment,
      inputSchema: chatToolInputSchemas.apply_cv_adjustment,
      execute: async ({ approvalId }): Promise<ChatToolOutput> => {
        const tr = await t()
        return toolApplyCvAdjustment(
          ctx,
          approvalId,
          state.conversationId,
          tr("cvApplied")
        )
      },
    }),
    ensure_hybrid_cv: tool({
      description: CHAT_TOOL_DESCRIPTIONS.ensure_hybrid_cv,
      inputSchema: chatToolInputSchemas.ensure_hybrid_cv,
      execute: async (): Promise<ChatToolOutput> => {
        const tr = await t()
        const { trackId } = await ensureHybridTrack(ctx)
        return {
          kind: "deep_link",
          href: `/app/cvs?track=${trackId}`,
          label: tr("hybridReady"),
          summary: tr("hybridReady"),
        }
      },
    }),
    list_cv_tracks: tool({
      description: CHAT_TOOL_DESCRIPTIONS.list_cv_tracks,
      inputSchema: chatToolInputSchemas.list_cv_tracks,
      execute: async (): Promise<ChatToolOutput> => {
        const tr = await t()
        const library = await loadCvLibrary(ctx)
        return {
          kind: "profile",
          profile: library,
          summary: tr("tracksListed", { count: library.tracks.length }),
        }
      },
    }),
    create_application: tool({
      description: CHAT_TOOL_DESCRIPTIONS.create_application,
      inputSchema: chatToolInputSchemas.create_application,
      execute: async (input): Promise<ChatToolOutput> => {
        const tr = await t()
        const status = input.status ?? "em_andamento"
        const match = await ctx.supabase
          .from("job_matches")
          .select("id, job_posting_id")
          .eq("id", input.jobMatchId)
          .eq("user_id", ctx.user.id)
          .maybeSingle()
        if (!match.data) {
          return { kind: "error", code: "not_found", summary: tr("notFound") }
        }
        const postingId = (match.data as { job_posting_id: string })
          .job_posting_id
        const posting = await ctx.supabase
          .from("job_postings")
          .select("title, company")
          .eq("id", postingId)
          .maybeSingle()
        if (!posting.data) {
          return { kind: "error", code: "not_found", summary: tr("notFound") }
        }
        const job = posting.data as { title: string; company: string | null }
        const insert = await ctx.supabase
          .from("applications")
          .insert({
            user_id: ctx.user.id,
            job_match_id: input.jobMatchId,
            company: job.company ?? "Empresa",
            role_title: job.title,
            status,
            cv_version_id: input.cvVersionId ?? null,
          })
          .select("id, status")
          .single()
        if (insert.error || !insert.data) {
          return {
            kind: "error",
            code: "write_failed",
            summary: tr("notFound"),
          }
        }
        const app = insert.data as { id: string; status: string }
        await linkChatRecord(ctx, {
          conversationId: state.conversationId,
          tableName: "applications",
          recordId: app.id,
          action: "created",
        })
        return {
          kind: "application_card",
          applicationId: app.id,
          company: job.company ?? "Empresa",
          roleTitle: job.title,
          status: app.status,
          summary: tr("applicationCreated"),
        }
      },
    }),
    update_application_status: tool({
      description: CHAT_TOOL_DESCRIPTIONS.update_application_status,
      inputSchema: chatToolInputSchemas.update_application_status,
      execute: async ({ applicationId, status }): Promise<ChatToolOutput> => {
        const tr = await t()
        if (status === "enviada") {
          return {
            kind: "error",
            code: "needs_approval",
            summary: tr("needsSubmitApproval"),
          }
        }
        const current = await ctx.supabase
          .from("applications")
          .select("id, company, role_title, status")
          .eq("id", applicationId)
          .eq("user_id", ctx.user.id)
          .maybeSingle()
        const row = current.data as {
          id: string
          company: string
          role_title: string
          status: ApplicationStatus
        } | null
        if (!row) {
          return { kind: "error", code: "not_found", summary: tr("notFound") }
        }
        await ctx.supabase
          .from("applications")
          .update({ status })
          .eq("id", applicationId)
          .eq("user_id", ctx.user.id)
        await linkChatRecord(ctx, {
          conversationId: state.conversationId,
          tableName: "applications",
          recordId: applicationId,
          action: "updated",
        })
        return {
          kind: "status_change",
          applicationId,
          company: row.company,
          roleTitle: row.role_title,
          from: row.status,
          to: status,
          summary: tr("statusUpdated"),
        }
      },
    }),
    read_gmail: tool({
      description: CHAT_TOOL_DESCRIPTIONS.read_gmail,
      inputSchema: chatToolInputSchemas.read_gmail,
      execute: async (input): Promise<ChatToolOutput> => {
        const tr = await t()
        const threads = await summarizeGmailThreads(ctx, input)
        return {
          kind: "profile",
          profile: threads,
          summary: tr("gmailRead", { count: threads.length }),
        }
      },
    }),
    get_profile_tracking: tool({
      description: CHAT_TOOL_DESCRIPTIONS.get_profile_tracking,
      inputSchema: chatToolInputSchemas.get_profile_tracking,
      execute: async (): Promise<ChatToolOutput> => {
        const tr = await t()
        const { data } = await ctx.supabase
          .from("platform_profiles")
          .select("id, platform, url, outdated, outdated_reason")
          .eq("user_id", ctx.user.id)
          .order("platform")
        const platforms = (data ?? []) as {
          id: string
          platform: string
          url: string | null
          outdated: boolean
          outdated_reason: string | null
        }[]
        return {
          kind: "profile_tracking",
          platforms: platforms.map((row) => ({
            id: row.id,
            platform: row.platform,
            url: row.url,
            outdated: row.outdated,
            outdatedReason: row.outdated_reason,
          })),
          summary: tr("profileTracking"),
        }
      },
    }),
    mark_profile_updated: tool({
      description: CHAT_TOOL_DESCRIPTIONS.mark_profile_updated,
      inputSchema: chatToolInputSchemas.mark_profile_updated,
      execute: async ({ platformProfileId }): Promise<ChatToolOutput> => {
        const tr = await t()
        await ctx.supabase
          .from("platform_profiles")
          .update({
            outdated: false,
            outdated_reason: null,
            last_updated_at: new Date().toISOString(),
          })
          .eq("id", platformProfileId)
          .eq("user_id", ctx.user.id)
        return {
          kind: "deep_link",
          href: "/app/perfil#plataformas",
          label: tr("profileUpdated"),
          summary: tr("profileUpdated"),
        }
      },
    }),
    classify_fact: tool({
      description: CHAT_TOOL_DESCRIPTIONS.classify_fact,
      inputSchema: chatToolInputSchemas.classify_fact,
      execute: async ({ factId, usage }): Promise<ChatToolOutput> => {
        const tr = await t()
        const fact = await ctx.supabase
          .from("confirmed_facts")
          .select("id, statement")
          .eq("id", factId)
          .eq("user_id", ctx.user.id)
          .maybeSingle()
        if (!fact.data) {
          return { kind: "error", code: "not_found", summary: tr("notFound") }
        }
        await ctx.supabase
          .from("confirmed_facts")
          .update({ usage })
          .eq("id", factId)
          .eq("user_id", ctx.user.id)
        if (usage === "cv_relevant") {
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
        return {
          kind: "fact_classification",
          factId,
          statement: (fact.data as { statement: string }).statement,
          suggestedUsage: usage,
          destinations: ["save_fact"],
          summary: tr("factClassified"),
        }
      },
    }),
    answer_missing_info: tool({
      description: CHAT_TOOL_DESCRIPTIONS.answer_missing_info,
      inputSchema: chatToolInputSchemas.answer_missing_info,
      execute: async ({
        pendingQuestionId,
        answerText,
      }): Promise<ChatToolOutput> => {
        const tr = await t()
        const q = await ctx.supabase
          .from("pending_questions")
          .select("id, question_text")
          .eq("id", pendingQuestionId)
          .eq("user_id", ctx.user.id)
          .maybeSingle()
        if (!q.data) {
          return { kind: "error", code: "not_found", summary: tr("notFound") }
        }
        return {
          kind: "fact_classification",
          statement: answerText,
          suggestedUsage: "form_only",
          destinations: [
            "application_only",
            "save_fact",
            "update_cvs",
            "register_gap",
          ],
          summary: tr("missingInfoSuggest"),
        }
      },
    }),
  }
}
