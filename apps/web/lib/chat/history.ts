import type { UIMessage } from "ai"

type AnyPart = Record<string, unknown> & { type: string }

function toolNameOf(part: AnyPart): string | null {
  if (part.type === "dynamic-tool") {
    return typeof part.toolName === "string" ? part.toolName : null
  }
  if (part.type.startsWith("tool-")) return part.type.slice("tool-".length)
  return null
}

function cleanPart(
  part: AnyPart,
  toolNames: ReadonlySet<string>
): AnyPart | null {
  if (part.type === "text") {
    const text = typeof part.text === "string" ? part.text.trim() : ""
    return text ? { type: "text", text } : null
  }
  const toolName = toolNameOf(part)
  if (toolName !== null) {
    // Widgets written without the model (attachment prompt, ingest, actions) and failed or
    // incomplete calls can't be replayed to the provider; they poisoned the conversation.
    if (!toolNames.has(toolName) || part.state !== "output-available")
      return null
    // Replayed as text: provider-specific call metadata (Gemini thought signatures) doesn't
    // survive storage or a model fallback, and a bad replayed call fails the whole request.
    let output = ""
    try {
      output = JSON.stringify(part.output ?? null).slice(0, 1500)
    } catch {
      output = "(resultado)"
    }
    return { type: "text", text: `[ferramenta ${toolName} → ${output}]` }
  }
  return null
}

/**
 * History safe to send to the model: text plus completed calls of tools that exist in this
 * turn. Failed turns (an error reply, or a user message that never got an answer) are dropped
 * so one failure doesn't make every later message in the conversation fail too.
 */
export function sanitizeHistory(
  history: UIMessage[],
  toolNames: Iterable<string>,
  failedReplies: readonly string[] = []
): UIMessage[] {
  const names = new Set(toolNames)
  const failed = new Set(failedReplies.map((text) => text.trim()))
  const cleaned: UIMessage[] = []
  for (const message of history) {
    if (message.role === "system") continue
    const parts = (message.parts as unknown as AnyPart[])
      .map((part) => cleanPart(part, names))
      .filter((part): part is AnyPart => part !== null)
    const onlyText = parts.every((part) => part.type === "text")
    const text = parts
      .map((part) => part.text)
      .join("\n")
      .trim()
    if (message.role === "assistant" && onlyText && failed.has(text)) {
      // Error reply: drop it and the question that caused it.
      if (cleaned[cleaned.length - 1]?.role === "user") cleaned.pop()
      continue
    }
    if (parts.length === 0) {
      // An assistant turn made only of widgets still answered the user: keep a marker.
      if (message.role === "assistant") {
        cleaned.push({
          id: message.id,
          role: "assistant",
          parts: [{ type: "text", text: "(mostrei opções na tela)" }],
        })
      }
      continue
    }
    if (
      message.role === "user" &&
      cleaned[cleaned.length - 1]?.role === "user"
    ) {
      // The previous user message never got an answer (server died): drop it.
      cleaned.pop()
    }
    cleaned.push({ id: message.id, role: message.role, parts } as UIMessage)
  }
  // The current turn is appended by the caller; a trailing unanswered user message goes.
  if (cleaned[cleaned.length - 1]?.role === "user") cleaned.pop()
  return cleaned
}

/** Provider quota/rate-limit errors (Gemini free tier: per-minute limits). */
export function isQuotaError(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; depth < 5 && current; depth++) {
    const e = current as {
      statusCode?: number
      message?: string
      lastError?: unknown
      cause?: unknown
    }
    if (e.statusCode === 429) return true
    if (
      typeof e.message === "string" &&
      /quota|rate.?limit|RESOURCE_EXHAUSTED/i.test(e.message)
    ) {
      return true
    }
    current = e.lastError ?? e.cause
  }
  return false
}
