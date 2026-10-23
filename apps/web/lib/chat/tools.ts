import "server-only"

import { createHash } from "node:crypto"

import { tool, type ToolSet } from "ai"
import { getTranslations } from "next-intl/server"

import {
  CHAT_TOOL_DESCRIPTIONS,
  chatToolInputSchemas,
  createEmbedder,
  createFactSearch,
} from "@vagapilot/ai"
import { MAX_LINKS_PER_BATCH } from "@vagapilot/core/guardrails"
import { looksLikeJobPosting } from "@vagapilot/core/job-text"
import {
  suggestSalary,
  type Regime,
  type Seniority,
} from "@vagapilot/core/job-rules"
import {
  isAllowedNow,
  policyCheck,
  type ToolOrigin,
} from "@vagapilot/core/policy"
import {
  isTerminalStatus,
  type ApplicationStatus,
} from "@vagapilot/core/status"
import { searchConfirmedFacts } from "@vagapilot/db/server"

import { buildExtendedChatTools } from "@/lib/chat/extended-tools"
import { buildDeepLink } from "@/lib/chat/screens"
import {
  loadJobCards,
  recordDecision,
  startIngestion,
} from "@/lib/chat/jobs-server"
import type { ChatToolOutput } from "@/lib/chat/types"
import { getProfileSummary } from "@/lib/profile/summary"
import { audit } from "@/lib/server/audit"
import type { UserContext } from "@/lib/server/context"
import {
  toolDraftApplicationEmail,
  toolRequestSendEmail,
  toolSendEmail,
} from "@/lib/email/chat-tools"
import { assertFeatureEnabled } from "@/lib/entitlements/server"
import {
  applySettingChange,
  getSettingsSnapshot,
  undoMemoryEvent,
  type SettingIntent,
} from "@/lib/settings/server"

/*
 * Tool allowlist of the orchestrator (10.3, F14). Each execute re-checks `policy.check` on the
 * server. Tools that return third-party text (job postings) mark the turn as tainted: any
 * effect requested after that in the same turn needs a confirmation card (CA14.8).
 */

export type ChatTurnState = {
  conversationId: string
  utterance: string
  untrustedSeen: boolean
  screenContext?: {
    screen?: string
    pathname?: string
    applicationId?: string | null
    jobPostingId?: string | null
    cvVersionId?: string | null
  }
}

async function latestMatchForPosting(
  ctx: UserContext,
  jobPostingId: string
): Promise<string | null> {
  const { data } = await ctx.supabase
    .from("job_matches")
    .select("id")
    .eq("user_id", ctx.user.id)
    .eq("job_posting_id", jobPostingId)
    .maybeSingle()
  return (data as { id: string } | null)?.id ?? null
}

export function buildChatTools(
  ctx: UserContext,
  state: ChatTurnState
): ToolSet {
  if (looksLikeJobPosting(state.utterance)) state.untrustedSeen = true
  const origin = (): ToolOrigin =>
    state.untrustedSeen ? "untrusted_content" : "user_turn"
  const t = () => getTranslations("ChatTools")

  async function setting(
    intent: SettingIntent,
    input: unknown
  ): Promise<ChatToolOutput> {
    return applySettingChange(ctx, {
      intent,
      input,
      origin: "chat",
      policyOrigin: origin(),
      utterance: state.utterance,
      conversationId: state.conversationId,
    })
  }

  const settingTool = (intent: SettingIntent) =>
    tool({
      description: CHAT_TOOL_DESCRIPTIONS[intent],
      inputSchema: chatToolInputSchemas[intent],
      execute: async (input: unknown) => setting(intent, input),
    })

  return {
    ...buildExtendedChatTools(ctx, state),
    ingest_job_postings: tool({
      description: CHAT_TOOL_DESCRIPTIONS.ingest_job_postings,
      inputSchema: chatToolInputSchemas.ingest_job_postings,
      execute: async (input): Promise<ChatToolOutput> => {
        const tr = await t()
        const urls = (input.urls ?? []).slice(0, MAX_LINKS_PER_BATCH)
        const batch = await startIngestion(ctx, {
          urls,
          text: input.text,
          conversationId: state.conversationId,
        })
        return {
          kind: "ingest_batch",
          ...batch,
          summary: tr("ingest", { count: batch.items.length }),
        }
      },
    }),
    get_job_match: tool({
      description: CHAT_TOOL_DESCRIPTIONS.get_job_match,
      inputSchema: chatToolInputSchemas.get_job_match,
      execute: async ({ jobPostingId }): Promise<ChatToolOutput> => {
        const tr = await t()
        const matchId = await latestMatchForPosting(ctx, jobPostingId)
        const [card] = matchId ? await loadJobCards(ctx, [matchId]) : []
        state.untrustedSeen = true
        if (!card)
          return { kind: "error", code: "not_found", summary: tr("notFound") }
        return {
          kind: "job_card",
          jobMatchId: card.matchId,
          fit: card.fit,
          reasons: card.reasons.map((reason) => reason.text).slice(0, 5),
          gaps: card.gaps.map((gap) => gap.requirement),
          alerts: card.alerts.map((alert) => alert.code),
          summary: tr("jobMatch", { title: card.title }),
        }
      },
    }),
    check_duplicate: tool({
      description: CHAT_TOOL_DESCRIPTIONS.check_duplicate,
      inputSchema: chatToolInputSchemas.check_duplicate,
      execute: async ({ jobPostingId }): Promise<ChatToolOutput> => {
        const tr = await t()
        const matchId = await latestMatchForPosting(ctx, jobPostingId)
        const [card] = matchId ? await loadJobCards(ctx, [matchId]) : []
        const status = card?.duplicate?.status ?? "nao_aplicado"
        return {
          kind: "duplicate",
          status,
          appliedAt: card?.duplicate?.appliedAt ?? null,
          summary: tr(`duplicate.${status}`),
        }
      },
    }),
    search_facts: tool({
      description: CHAT_TOOL_DESCRIPTIONS.search_facts,
      inputSchema: chatToolInputSchemas.search_facts,
      execute: async ({ query, k }): Promise<ChatToolOutput> => {
        const tr = await t()
        const search = createFactSearch({
          embedder: createEmbedder(),
          store: {
            searchConfirmed: async (userId, embedding, limit) =>
              (
                await searchConfirmedFacts(
                  ctx.supabase,
                  userId,
                  embedding,
                  limit
                )
              ).map((fact) => ({
                id: fact.id,
                experienceId: fact.experienceId,
                statement: fact.statement,
                kind: fact.kind,
                tags: fact.tags,
                status: fact.status,
                similarity: fact.similarity,
              })),
          },
        })
        const facts = await search(ctx.user.id, query, k)
        return {
          kind: "facts",
          facts: facts.map((fact) => ({
            id: fact.id,
            statement: fact.statement,
          })),
          summary: tr("facts", { count: facts.length }),
        }
      },
    }),
    get_profile_summary: tool({
      description: CHAT_TOOL_DESCRIPTIONS.get_profile_summary,
      inputSchema: chatToolInputSchemas.get_profile_summary,
      execute: async (): Promise<ChatToolOutput> => {
        const tr = await t()
        return {
          kind: "profile",
          profile: await getProfileSummary(ctx),
          summary: tr("profile"),
        }
      },
    }),
    recommend_cv: tool({
      description: CHAT_TOOL_DESCRIPTIONS.recommend_cv,
      inputSchema: chatToolInputSchemas.recommend_cv,
      execute: async ({ jobPostingId }): Promise<ChatToolOutput> => {
        const tr = await t()
        const matchId = await latestMatchForPosting(ctx, jobPostingId)
        const [card] = matchId ? await loadJobCards(ctx, [matchId]) : []
        return {
          kind: "cv",
          cvVersionId: card?.cv?.id ?? null,
          label: card?.cv?.label ?? null,
          language: card?.cv?.language ?? "pt-BR",
          summary: card?.cv ? tr("cv", { label: card.cv.label }) : tr("noCv"),
        }
      },
    }),
    suggest_salary: tool({
      description: CHAT_TOOL_DESCRIPTIONS.suggest_salary,
      inputSchema: chatToolInputSchemas.suggest_salary,
      execute: async ({ seniority, regime }): Promise<ChatToolOutput> => {
        const tr = await t()
        const snapshot = await getSettingsSnapshot(ctx)
        const result = suggestSalary(
          snapshot.salaryRules.map((rule) => ({
            seniority: rule.seniority as Seniority,
            regime: rule.regime as Regime,
            min: rule.amount_min,
            target: rule.amount_target,
            currency: rule.currency,
            period: rule.period,
          })),
          { seniority, regime }
        )
        const target = result.status === "rule" ? result.rule.target : null
        const currency = result.status === "rule" ? result.rule.currency : "BRL"
        return {
          kind: "salary",
          status: result.status,
          target,
          currency,
          summary: target
            ? tr("salary", { amount: target.toLocaleString("pt-BR") })
            : tr("noSalary"),
        }
      },
    }),
    record_decision: tool({
      description: CHAT_TOOL_DESCRIPTIONS.record_decision,
      inputSchema: chatToolInputSchemas.record_decision,
      execute: async ({
        jobMatchId,
        decision,
        reason,
      }): Promise<ChatToolOutput> => {
        const tr = await t()
        if (
          !isAllowedNow(
            policyCheck({ tool: "record_decision", origin: origin() })
          )
        ) {
          return {
            kind: "error",
            code: "untrusted_origin",
            summary: tr("denied"),
          }
        }
        const result = await recordDecision(ctx, {
          matchId: jobMatchId,
          decision,
          reason,
          source: "agente",
        })
        return {
          kind: "status_change",
          applicationId: result.applicationId,
          company: result.company,
          roleTitle: result.roleTitle,
          from: result.from,
          to: result.to,
          summary: tr(`decision.${decision}`, { title: result.roleTitle }),
        }
      },
    }),
    list_pending_actions: tool({
      description: CHAT_TOOL_DESCRIPTIONS.list_pending_actions,
      inputSchema: chatToolInputSchemas.list_pending_actions,
      execute: async (): Promise<ChatToolOutput> => {
        const tr = await t()
        const { data, error } = await ctx.supabase
          .from("applications")
          .select(
            "id, company, role_title, status, applied_at, next_action, next_action_due_at"
          )
          .eq("user_id", ctx.user.id)
          .limit(1000)
        if (error)
          return { kind: "error", code: "read_failed", summary: tr("notFound") }
        const rows = data as {
          id: string
          company: string
          role_title: string
          status: ApplicationStatus
          applied_at: string | null
          next_action: string | null
          next_action_due_at: string | null
        }[]
        const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
        const actions = rows
          .filter((row) => row.next_action)
          .sort((a, b) =>
            (a.next_action_due_at ?? "9999").localeCompare(
              b.next_action_due_at ?? "9999"
            )
          )
          .map((row) => ({
            applicationId: row.id,
            company: row.company,
            roleTitle: row.role_title,
            action: row.next_action ?? "",
            dueAt: row.next_action_due_at,
          }))
        const counts = {
          sentThisWeek: rows.filter(
            (row) =>
              row.applied_at && new Date(row.applied_at).getTime() >= weekAgo
          ).length,
          active: rows.filter((row) => !isTerminalStatus(row.status)).length,
          pending: actions.length,
        }
        return {
          kind: "action_list",
          actions,
          counts,
          summary: tr("pending", counts),
        }
      },
    }),
    get_settings: tool({
      description: CHAT_TOOL_DESCRIPTIONS.get_settings,
      inputSchema: chatToolInputSchemas.get_settings,
      execute: async (): Promise<ChatToolOutput> => {
        const tr = await t()
        const snapshot = await getSettingsSnapshot(ctx)
        return {
          kind: "settings",
          snapshot,
          summary: tr("settingsRead", {
            searches: snapshot.savedSearches.length,
            excluded: snapshot.excludedCompanies.length,
          }),
        }
      },
    }),
    ask_clarification: tool({
      description: CHAT_TOOL_DESCRIPTIONS.ask_clarification,
      inputSchema: chatToolInputSchemas.ask_clarification,
      execute: async ({ question, options }): Promise<ChatToolOutput> => ({
        kind: "clarification",
        question,
        options,
        summary: (await t())("clarification"),
      }),
    }),
    create_saved_search: settingTool("create_saved_search"),
    update_saved_search: settingTool("update_saved_search"),
    delete_saved_search: settingTool("delete_saved_search"),
    add_excluded_company: settingTool("add_excluded_company"),
    remove_excluded_company: settingTool("remove_excluded_company"),
    update_language_level: settingTool("update_language_level"),
    set_salary_rules: settingTool("set_salary_rules"),
    set_preference: settingTool("set_preference"),
    set_approval_mode: settingTool("set_approval_mode"),
    undo_change: tool({
      description: CHAT_TOOL_DESCRIPTIONS.undo_change,
      inputSchema: chatToolInputSchemas.undo_change,
      execute: async ({ memoryEventId }): Promise<ChatToolOutput> => {
        if (
          !isAllowedNow(policyCheck({ tool: "undo_change", origin: origin() }))
        ) {
          return {
            kind: "error",
            code: "untrusted_origin",
            summary: (await t())("denied"),
          }
        }
        return undoMemoryEvent(ctx, memoryEventId)
      },
    }),
    propose_fact: tool({
      description: CHAT_TOOL_DESCRIPTIONS.propose_fact,
      inputSchema: chatToolInputSchemas.propose_fact,
      execute: async ({
        statement,
        kind,
        experienceId,
      }): Promise<ChatToolOutput> => {
        const tr = await t()
        return proposeFact(ctx, {
          statement,
          kind,
          experienceId: experienceId ?? null,
          summary: tr("factProposed"),
        })
      },
    }),
    export_tracker: tool({
      description: CHAT_TOOL_DESCRIPTIONS.export_tracker,
      inputSchema: chatToolInputSchemas.export_tracker,
      execute: async ({ format }): Promise<ChatToolOutput> => {
        const tr = await t()
        const fmt = format ?? "csv"
        if (fmt === "pdf") {
          try {
            await assertFeatureEnabled(ctx.user.id, "trackerExport")
          } catch {
            return {
              kind: "error",
              code: "feature_denied",
              summary: tr("denied"),
            }
          }
        }
        return {
          kind: "export_link",
          format: fmt,
          path: `/api/applications/export?format=${fmt}`,
          summary: tr("exportTracker", { format: fmt.toUpperCase() }),
        }
      },
    }),
    draft_application_email: tool({
      description: CHAT_TOOL_DESCRIPTIONS.draft_application_email,
      inputSchema: chatToolInputSchemas.draft_application_email,
      execute: async ({ applicationId }): Promise<ChatToolOutput> => {
        const tr = await t()
        return toolDraftApplicationEmail(ctx, applicationId, tr("emailDraft"))
      },
    }),
    request_send_email: tool({
      description: CHAT_TOOL_DESCRIPTIONS.request_send_email,
      inputSchema: chatToolInputSchemas.request_send_email,
      execute: async ({ draftId }): Promise<ChatToolOutput> => {
        const tr = await t()
        return toolRequestSendEmail(ctx, draftId, tr("emailApproval"))
      },
    }),
    send_email: tool({
      description: CHAT_TOOL_DESCRIPTIONS.send_email,
      inputSchema: chatToolInputSchemas.send_email,
      execute: async ({ approvalId }): Promise<ChatToolOutput> => {
        const tr = await t()
        return toolSendEmail(ctx, approvalId, tr("emailSent"))
      },
    }),
    open_screen: tool({
      description: CHAT_TOOL_DESCRIPTIONS.open_screen,
      inputSchema: chatToolInputSchemas.open_screen,
      execute: async (input): Promise<ChatToolOutput> => {
        const tr = await t()
        const href = buildDeepLink({
          screen: input.screen,
          applicationId: input.applicationId,
          cvVersionId: input.cvVersionId,
          factId: input.factId,
          searchId: input.searchId,
        })
        return {
          kind: "deep_link",
          href,
          label: tr("deepLink", { screen: input.screen }),
          summary: tr("deepLinkSummary"),
        }
      },
    }),
  }
}

/**
 * `propose_fact` (RF2.3, RF14.7): the fact is stored as `proposto` with an approval
 * (`criar_fato`, 24 h, preview hash); it only becomes `confirmado` after the person's click.
 */
async function proposeFact(
  ctx: UserContext,
  input: {
    statement: string
    kind: string
    experienceId: string | null
    summary: string
  }
): Promise<ChatToolOutput> {
  let experienceId = input.experienceId
  if (experienceId) {
    const owned = await ctx.supabase
      .from("experiences")
      .select("id")
      .eq("id", experienceId)
      .eq("user_id", ctx.user.id)
      .maybeSingle()
    if (!owned.data) experienceId = null
  }
  const fact = await ctx.supabase
    .from("confirmed_facts")
    .insert({
      user_id: ctx.user.id,
      experience_id: experienceId,
      statement: input.statement,
      kind: input.kind,
      status: "proposto",
      source: "chat",
      source_ref: { via: "chat" },
    })
    .select("id")
    .single()
  if (fact.error || !fact.data)
    return { kind: "error", code: "write_failed", summary: input.summary }
  const factId = String((fact.data as { id: string }).id)
  const preview = { statement: input.statement, kind: input.kind }
  const approval = await ctx.supabase
    .from("approvals")
    .insert({
      user_id: ctx.user.id,
      kind: "criar_fato",
      subject_ref: { fact_id: factId },
      preview,
      preview_sha256: createHash("sha256")
        .update(JSON.stringify(preview))
        .digest("hex"),
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    })
    .select("id")
    .single()
  if (approval.error || !approval.data)
    return { kind: "error", code: "write_failed", summary: input.summary }
  const approvalId = String((approval.data as { id: string }).id)
  await audit({
    userId: ctx.user.id,
    actor: "agente",
    action: "fact.proposed",
    targetType: "confirmed_fact",
    targetId: factId,
    approvalId,
    details: { source: "chat", kind: input.kind },
  })
  await audit({
    userId: ctx.user.id,
    actor: "agente",
    action: "approval.requested",
    targetType: "approval",
    targetId: approvalId,
    details: { kind: "criar_fato" },
  })
  return {
    kind: "fact_approval",
    approvalId,
    factId,
    statement: input.statement,
    summary: input.summary,
  }
}
