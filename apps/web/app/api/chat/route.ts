import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream,
  type ModelMessage,
  type UIMessage,
} from "ai"
import { getTranslations } from "next-intl/server"
import { z } from "zod"

import {
  classifyTopic,
  llmTelemetryOptions,
  ORCHESTRATOR_SYSTEM_V1,
  resolveChatModel,
} from "@vagapilot/ai"
import {
  CHAT_MESSAGES_PER_MINUTE,
  extractUrls,
  isRefusedVerdict,
  MAX_CHAT_INPUT_CHARS,
  MAX_LINKS_PER_BATCH,
  RATE_LIMIT_WINDOW_MS,
  type TopicVerdict,
} from "@vagapilot/core/guardrails"

import {
  ensureConversation,
  loadUIMessages,
  recentUserMessageCount,
  saveMessage,
} from "@/lib/chat/conversations"
import { startIngestion } from "@/lib/chat/jobs-server"
import { outputFilterTransform } from "@/lib/chat/output-filter"
import { buildChatTools, type ChatTurnState } from "@/lib/chat/tools"
import type { ChatToolOutput } from "@/lib/chat/types"
import { apiError } from "@/lib/http"
import { audit } from "@/lib/server/audit"
import { getUserContext, type UserContext } from "@/lib/server/context"
import { checkUpstashRateLimit } from "@/lib/server/upstash-ratelimit"

/** POST /api/chat (spec 8.4, 8.5, 10.2, F7, F14 guardrails). */
export const maxDuration = 60

const bodySchema = z.object({
  id: z.uuid(),
  message: z.object({
    id: z.string().max(200),
    role: z.literal("user"),
    parts: z
      .array(
        z.object({
          type: z.literal("text"),
          text: z.string().max(MAX_CHAT_INPUT_CHARS * 2),
        })
      )
      .min(1)
      .max(4),
  }),
})

function textOf(message: Pick<UIMessage, "parts">): string {
  return message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n")
    .trim()
}

function persistOnEnd(ctx: UserContext, conversationId: string) {
  return async ({ responseMessage }: { responseMessage: UIMessage }) => {
    if (responseMessage.parts.length === 0) return
    try {
      await saveMessage(ctx, conversationId, {
        role: "assistant",
        parts: responseMessage.parts,
      })
    } catch (error) {
      console.error("chat message persist failed", {
        reason: error instanceof Error ? error.message : "unknown",
      })
    }
  }
}

/** Assistant reply written without the model (refusals, deterministic link analysis). */
function directResponse(
  ctx: UserContext,
  conversationId: string,
  originalMessages: UIMessage[],
  write: (
    writer: Parameters<
      Parameters<typeof createUIMessageStream>[0]["execute"]
    >[0]["writer"]
  ) => Promise<void>
) {
  const stream = createUIMessageStream({
    originalMessages,
    execute: async ({ writer }) => {
      writer.write({ type: "start" })
      await write(writer)
      writer.write({ type: "finish" })
    },
    onEnd: persistOnEnd(ctx, conversationId),
  })
  return createUIMessageStreamResponse({ stream })
}

function refusalKey(verdict: TopicVerdict) {
  switch (verdict) {
    case "off_topic":
    case "injection":
    case "prompt_leak":
    case "fraud":
    case "discriminatory":
      return verdict
    case "in_scope":
    case "unknown":
      return "off_topic"
    default: {
      const unreachable: never = verdict
      throw new Error(`Unknown verdict: ${String(unreachable)}`)
    }
  }
}

function textOnlyHistory(history: UIMessage[]): UIMessage[] {
  return history
    .map((message) => ({
      ...message,
      parts: message.parts.filter((part) => part.type === "text"),
    }))
    .filter((message) => message.parts.length > 0)
}

export async function POST(request: Request) {
  const t = await getTranslations("Chat.api")
  const context = await getUserContext()
  if (!context.ok) return apiError("unauthorized", t("unauthorized"), 401)
  const ctx = context.ctx

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return apiError("invalid_request", t("invalid"), 400)
  }
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) return apiError("invalid_request", t("invalid"), 400)
  const text = textOf(parsed.data.message)
  if (!text) return apiError("invalid_request", t("invalid"), 400)
  if (text.length > MAX_CHAT_INPUT_CHARS) {
    return apiError(
      "input_too_long",
      t("tooLong", { max: MAX_CHAT_INPUT_CHARS.toLocaleString("pt-BR") }),
      413
    )
  }

  const upstash = await checkUpstashRateLimit(
    `chat:${ctx.user.id}`,
    CHAT_MESSAGES_PER_MINUTE,
    "1 m"
  )
  if (upstash.limited) {
    await audit({
      userId: ctx.user.id,
      actor: "usuario",
      action: "ratelimit.hit",
      details: { limit: "chat_upstash" },
    })
    return apiError(
      "rate_limited",
      t("rateLimited", { limit: CHAT_MESSAGES_PER_MINUTE }),
      429
    )
  }

  if (
    (await recentUserMessageCount(ctx, RATE_LIMIT_WINDOW_MS)) >=
    CHAT_MESSAGES_PER_MINUTE
  ) {
    await audit({
      userId: ctx.user.id,
      actor: "usuario",
      action: "ratelimit.hit",
      details: { limit: "chat_per_minute" },
    })
    return apiError(
      "rate_limited",
      t("rateLimited", { limit: CHAT_MESSAGES_PER_MINUTE }),
      429
    )
  }
  const urls = extractUrls(text)
  if (urls.length > MAX_LINKS_PER_BATCH) {
    await audit({
      userId: ctx.user.id,
      actor: "usuario",
      action: "ratelimit.hit",
      details: { limit: "links_per_batch" },
    })
    return apiError(
      "too_many_links",
      t("tooManyLinks", { max: MAX_LINKS_PER_BATCH }),
      429
    )
  }

  let conversation
  try {
    conversation = await ensureConversation(ctx, parsed.data.id)
  } catch {
    return apiError("not_found", t("invalid"), 404)
  }
  const history = await loadUIMessages(ctx, conversation.id)
  const userMessage: UIMessage = {
    id: parsed.data.message.id,
    role: "user",
    parts: [{ type: "text", text }],
  }
  await saveMessage(ctx, conversation.id, userMessage)
  const originalMessages = [...history, userMessage]

  const topic = await classifyTopic(text)
  if (isRefusedVerdict(topic.verdict)) {
    await audit({
      userId: ctx.user.id,
      actor: "sistema",
      action:
        topic.verdict === "injection" || topic.verdict === "prompt_leak"
          ? "chat.injection_blocked"
          : "chat.off_topic_refused",
      targetType: "conversation",
      targetId: conversation.id,
      details: {
        verdict: topic.verdict,
        reason: topic.reason,
        model: topic.model,
      },
    })
    const refusal = (await getTranslations("Chat.refusals"))(
      refusalKey(topic.verdict)
    )
    return directResponse(
      ctx,
      conversation.id,
      originalMessages,
      async (writer) => {
        writer.write({ type: "text-start", id: "refusal" })
        writer.write({ type: "text-delta", id: "refusal", delta: refusal })
        writer.write({ type: "text-end", id: "refusal" })
      }
    )
  }

  if (urls.length > 0) {
    const tTools = await getTranslations("ChatTools")
    return directResponse(
      ctx,
      conversation.id,
      originalMessages,
      async (writer) => {
        const toolCallId = `ingest-${crypto.randomUUID()}`
        writer.write({
          type: "tool-input-available",
          toolCallId,
          toolName: "ingest_job_postings",
          input: { urls },
        })
        try {
          const batch = await startIngestion(ctx, {
            urls,
            conversationId: conversation.id,
          })
          const output: ChatToolOutput = {
            kind: "ingest_batch",
            ...batch,
            summary: tTools("ingest", { count: batch.items.length }),
          }
          writer.write({ type: "tool-output-available", toolCallId, output })
          writer.write({ type: "text-start", id: "ingest" })
          writer.write({
            type: "text-delta",
            id: "ingest",
            delta: output.summary,
          })
          writer.write({ type: "text-end", id: "ingest" })
        } catch (error) {
          console.error("ingestion start failed", {
            reason: error instanceof Error ? error.message : "unknown",
          })
          writer.write({
            type: "tool-output-error",
            toolCallId,
            errorText: tTools("ingestFailed"),
          })
        }
      }
    )
  }

  const state: ChatTurnState = {
    conversationId: conversation.id,
    utterance: text,
    untrustedSeen: false,
  }
  const tools = buildChatTools(ctx, state)
  let messages: ModelMessage[]
  try {
    messages = await convertToModelMessages(originalMessages, {
      tools,
      ignoreIncompleteToolCalls: true,
    })
  } catch {
    messages = await convertToModelMessages([
      ...textOnlyHistory(history),
      userMessage,
    ])
  }
  try {
    const { assertOrchestratorBillable, recordOrchestratorCost } =
      await import("@/lib/entitlements/server")
    await assertOrchestratorBillable(ctx.user.id)
    void recordOrchestratorCost(ctx.user.id).catch(() => undefined)
  } catch {
    return apiError("conflict", t("planLimit"), 402)
  }

  const refusal = (await getTranslations("Chat.refusals"))("prompt_leak")
  const result = streamText({
    model: resolveChatModel().model,
    system: ORCHESTRATOR_SYSTEM_V1,
    messages,
    tools,
    stopWhen: isStepCount(8),
    maxOutputTokens: 1200,
    temperature: 0.2,
    experimental_transform: outputFilterTransform(refusal),
    ...llmTelemetryOptions("chat"),
  })
  result.consumeStream()
  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      originalMessages,
      onEnd: persistOnEnd(ctx, conversation.id),
      onError: () => t("failed"),
    }),
  })
}
