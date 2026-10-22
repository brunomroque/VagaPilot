/**
 * FAKE, DETERMINISTIC ORCHESTRATOR — tests, CI, e2e and local dev without an LLM key.
 * It maps the user's last message to tool calls with `parseSettingsIntent` and, after the
 * tools ran, writes a short pt-BR summary from their outputs. It never reads untrusted
 * content as instructions because it only looks at user turns. Not for production.
 */
import type {
  LanguageModelV4Message,
  LanguageModelV4Prompt,
  LanguageModelV4StreamPart,
} from "@ai-sdk/provider"
import { simulateReadableStream, type LanguageModel } from "ai"
import { MockLanguageModelV4 } from "ai/test"

import { FAKE_MODEL_ID } from "../fake.js"
import {
  resolveModel,
  type ModelOptions,
  type ResolvedModel,
} from "../models.js"
import {
  mergeClarification,
  parseSettingsIntent,
  type IntentCall,
} from "./intents.js"

type Prompt = LanguageModelV4Prompt
type Message = LanguageModelV4Message

const usage = {
  inputTokens: {
    total: 0,
    noCache: 0,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 0, text: 0, reasoning: undefined },
}

function userText(message: Message): string {
  if (message.role !== "user") return ""
  return message.content
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n")
    .trim()
}

type ToolCallRecord = { toolName: string; input: unknown }

function assistantToolCalls(message: Message): ToolCallRecord[] {
  if (message.role !== "assistant") return []
  const calls: ToolCallRecord[] = []
  for (const part of message.content) {
    if (part.type === "tool-call")
      calls.push({ toolName: part.toolName, input: part.input })
  }
  return calls
}

function outputValue(output: unknown): unknown {
  if (!output || typeof output !== "object") return output
  const typed = output as { type?: string; value?: unknown }
  return typed.type === "json" || typed.type === "text" ? typed.value : output
}

/** Short sentence per tool result; tools put a pt-BR `summary` in their output. */
export function summarizeToolResult(toolName: string, output: unknown): string {
  const value = outputValue(output)
  if (value && typeof value === "object" && "summary" in value) {
    const summary = (value as { summary?: unknown }).summary
    if (typeof summary === "string" && summary.trim()) return summary.trim()
  }
  switch (toolName) {
    case "ask_clarification":
      return "Escolha uma das opções acima para eu continuar."
    case "list_pending_actions":
      return "Aqui estão suas ações pendentes."
    case "get_settings":
      return "Estas são suas configurações atuais."
    default:
      return "Pronto."
  }
}

function previousClarification(
  prompt: Prompt
): { request: string; question: string } | null {
  for (let index = prompt.length - 2; index >= 0; index -= 1) {
    const message = prompt[index] as Message
    const clarification = assistantToolCalls(message).find(
      (call) => call.toolName === "ask_clarification"
    )
    if (!clarification) continue
    for (let back = index - 1; back >= 0; back -= 1) {
      const request = userText(prompt[back] as Message)
      if (request) {
        const question = (clarification.input as { question?: unknown } | null)
          ?.question
        return {
          request,
          question: typeof question === "string" ? question : "",
        }
      }
    }
    return null
  }
  return null
}

const HELP =
  "Posso analisar vagas (cole os links aqui), criar buscas salvas, ajustar preferências, idiomas e pretensão, e mostrar suas pendências. Por exemplo: “quero vagas de gerente de TI em São Paulo, híbrido, toda manhã”."

/** The plan for one model step, as stream parts. Exported for tests. */
export function planFakeStep(prompt: Prompt): LanguageModelV4StreamPart[] {
  const last = prompt[prompt.length - 1] as Message | undefined
  const text = (body: string): LanguageModelV4StreamPart[] => [
    { type: "stream-start", warnings: [] },
    { type: "text-start", id: "fake-text" },
    { type: "text-delta", id: "fake-text", delta: body },
    { type: "text-end", id: "fake-text" },
    {
      type: "finish",
      finishReason: { unified: "stop", raw: undefined },
      usage,
    },
  ]

  if (!last) return text(HELP)

  if (last.role === "tool") {
    const lines: string[] = []
    for (let index = prompt.length - 1; index >= 0; index -= 1) {
      const message = prompt[index] as Message
      if (message.role !== "tool") break
      for (const part of message.content) {
        if (part.type === "tool-result")
          lines.unshift(summarizeToolResult(part.toolName, part.output))
      }
    }
    return text([...new Set(lines)].join("\n"))
  }

  const current = userText(last)
  let calls: IntentCall[] = parseSettingsIntent(current)
  if (calls.length === 0) {
    const pending = previousClarification(prompt)
    if (pending && current.length <= 80) {
      calls = parseSettingsIntent(
        mergeClarification(pending.request, pending.question, current)
      )
    }
  }
  if (calls.length === 0) return text(HELP)

  return [
    { type: "stream-start", warnings: [] },
    ...calls.map((call, index): LanguageModelV4StreamPart => ({
      type: "tool-call",
      toolCallId: `fake-call-${Date.now().toString(36)}-${index}`,
      toolName: call.tool,
      input: JSON.stringify(call.input),
    })),
    {
      type: "finish",
      finishReason: { unified: "tool-calls", raw: undefined },
      usage,
    },
  ]
}

export function createFakeOrchestratorModel(): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    provider: "vagapilot-fake",
    modelId: FAKE_MODEL_ID,
    doStream: async ({ prompt }) => ({
      stream: simulateReadableStream({
        chunks: planFakeStep(prompt),
        chunkDelayInMs: null,
      }),
    }),
  })
}

/** Orchestrator model: gateway large model, or the fake one. */
export function resolveChatModel(options: ModelOptions = {}): ResolvedModel {
  return resolveModel(
    "large",
    (): LanguageModel => createFakeOrchestratorModel(),
    options
  )
}
