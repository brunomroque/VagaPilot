import {
  buildDuplicateSearchQuery,
  parseEmailAddress,
  toSnippet,
} from "@vagapilot/core/email"

import { getDefaultGmailRuntime, type GmailRuntime } from "./runtime.js"

/**
 * RF5.2 / CA5.2: "did I already apply?" search in Gmail, for the duplicate check of ingestion
 * (P2). Headers and Gmail snippet only — bodies are not opened. Answers within the time budget
 * (p95 < 5 s) or returns what it has as `partial`.
 */

export type DuplicateSearchInput = {
  company: string
  role?: string | null
  /** Company or ATS domains (e.g. from the posting URL). */
  domains?: readonly string[]
}

export type GmailDuplicateMatch = {
  messageId: string
  threadId: string
  subject: string
  fromAddress: string | null
  receivedAt: string
  snippet: string
}

export type GmailDuplicateResult =
  | { status: "not_connected" }
  | {
      status: "ok" | "partial"
      matches: GmailDuplicateMatch[]
      elapsedMs: number
    }

export const DUPLICATE_SEARCH_BUDGET_MS = 4_500
const MAX_MATCHES = 10

export async function searchGmailForDuplicates(
  userId: string,
  input: DuplicateSearchInput,
  options: { runtime?: GmailRuntime; budgetMs?: number } = {}
): Promise<GmailDuplicateResult> {
  const runtime = options.runtime ?? getDefaultGmailRuntime()
  const started = Date.now()
  const connection = await runtime.store.getConnection(userId)
  if (!connection || connection.status !== "ativo")
    return { status: "not_connected" }

  const controller = new AbortController()
  const budget = options.budgetMs ?? DUPLICATE_SEARCH_BUDGET_MS
  const timer = setTimeout(
    () => controller.abort(),
    Math.max(0, budget - (Date.now() - started))
  )
  const matches: GmailDuplicateMatch[] = []
  let partial = false
  try {
    const api = await runtime.apiFor(userId)
    const page = await api.listMessages(buildDuplicateSearchQuery(input), {
      maxResults: MAX_MATCHES,
      signal: controller.signal,
    })
    const results = await Promise.allSettled(
      page.messages
        .slice(0, MAX_MATCHES)
        .map((message) =>
          api.getMetadata(message.id, { signal: controller.signal })
        )
    )
    for (const result of results) {
      if (result.status === "rejected") {
        partial = true
        continue
      }
      const meta = result.value
      matches.push({
        messageId: meta.id,
        threadId: meta.threadId,
        subject: meta.subject,
        fromAddress: parseEmailAddress(meta.from).address,
        receivedAt: meta.receivedAt.toISOString(),
        snippet: toSnippet(meta.snippet, 300),
      })
    }
  } catch {
    partial = true
  } finally {
    clearTimeout(timer)
  }
  if (controller.signal.aborted) partial = true
  matches.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
  return {
    status: partial ? "partial" : "ok",
    matches,
    elapsedMs: Date.now() - started,
  }
}
