import { z } from "zod"

import { extractPlainText, type GmailPayloadPart } from "./mime.js"

/**
 * Minimal Gmail REST client (users.getProfile, messages.list/get, history.list) behind an
 * interface, so tests and dev use fixture mailboxes and never call Google.
 */

export const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me"

export type GmailMessageRef = { id: string; threadId: string }

export type GmailMessageMeta = {
  id: string
  threadId: string
  from: string
  subject: string
  /** Gmail's own preview (~200 chars). */
  snippet: string
  receivedAt: Date
}

export type GmailListPage = {
  messages: GmailMessageRef[]
  nextPageToken: string | null
}

export type GmailHistoryPage = {
  messageIds: string[]
  historyId: string
  nextPageToken: string | null
}

export type GmailCallOptions = { signal?: AbortSignal }

export interface GmailApi {
  getProfile(
    options?: GmailCallOptions
  ): Promise<{ emailAddress: string; historyId: string }>
  listMessages(
    query: string,
    options?: GmailCallOptions & {
      pageToken?: string | null
      maxResults?: number
    }
  ): Promise<GmailListPage>
  /** Throws `GmailApiError("history_expired")` when the start id is too old (404). */
  listHistory(
    startHistoryId: string,
    options?: GmailCallOptions & { pageToken?: string | null }
  ): Promise<GmailHistoryPage>
  /** Headers and Gmail snippet only; the body is not fetched. */
  getMetadata(id: string, options?: GmailCallOptions): Promise<GmailMessageMeta>
  /** Full body as text. Transient: callers must never persist or log it (CA11.4). */
  getBodyText(id: string, options?: GmailCallOptions): Promise<string>
}

export type GmailApiErrorCode =
  "unauthorized" | "history_expired" | "not_found" | "http_error"

export class GmailApiError extends Error {
  constructor(
    readonly code: GmailApiErrorCode,
    readonly status: number
  ) {
    super(`Gmail API error ${code} (${status})`)
    this.name = "GmailApiError"
  }
}

const headerSchema = z.object({ name: z.string(), value: z.string() })

const messageSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  snippet: z.string().optional().default(""),
  internalDate: z.string().optional(),
  payload: z
    .object({
      headers: z.array(headerSchema).optional().default([]),
    })
    .loose()
    .optional(),
})

const listSchema = z.object({
  messages: z
    .array(z.object({ id: z.string(), threadId: z.string() }))
    .optional()
    .default([]),
  nextPageToken: z.string().optional(),
})

const historySchema = z.object({
  history: z
    .array(
      z.object({
        messagesAdded: z
          .array(
            z.object({
              message: z.object({
                id: z.string(),
                labelIds: z.array(z.string()).optional(),
              }),
            })
          )
          .optional(),
      })
    )
    .optional()
    .default([]),
  historyId: z.string(),
  nextPageToken: z.string().optional(),
})

const profileSchema = z.object({
  emailAddress: z.string(),
  historyId: z.string(),
})

function header(headers: z.infer<typeof headerSchema>[], name: string): string {
  return (
    headers.find((item) => item.name.toLowerCase() === name.toLowerCase())
      ?.value ?? ""
  )
}

export type RestGmailApiOptions = {
  getAccessToken: () => Promise<string>
  fetch?: typeof fetch
  timeoutMs?: number
}

export function createRestGmailApi(options: RestGmailApiOptions): GmailApi {
  const doFetch = options.fetch ?? fetch
  const timeoutMs = options.timeoutMs ?? 15_000

  async function get(
    path: string,
    params: URLSearchParams,
    call?: GmailCallOptions
  ) {
    const token = await options.getAccessToken()
    const signals = [
      AbortSignal.timeout(timeoutMs),
      ...(call?.signal ? [call.signal] : []),
    ]
    const query = params.toString()
    const response = await doFetch(
      `${GMAIL_API_BASE}${path}${query ? `?${query}` : ""}`,
      {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.any(signals),
      }
    )
    if (!response.ok) {
      const code: GmailApiErrorCode =
        response.status === 401 || response.status === 403
          ? "unauthorized"
          : response.status === 404
            ? path.startsWith("/history")
              ? "history_expired"
              : "not_found"
            : "http_error"
      throw new GmailApiError(code, response.status)
    }
    return (await response.json()) as unknown
  }

  return {
    async getProfile(call) {
      return profileSchema.parse(
        await get("/profile", new URLSearchParams(), call)
      )
    },

    async listMessages(query, call) {
      const params = new URLSearchParams({
        q: query,
        maxResults: String(call?.maxResults ?? 100),
      })
      if (call?.pageToken) params.set("pageToken", call.pageToken)
      const page = listSchema.parse(await get("/messages", params, call))
      return {
        messages: page.messages,
        nextPageToken: page.nextPageToken ?? null,
      }
    },

    async listHistory(startHistoryId, call) {
      const params = new URLSearchParams({
        startHistoryId,
        historyTypes: "messageAdded",
      })
      if (call?.pageToken) params.set("pageToken", call.pageToken)
      const page = historySchema.parse(await get("/history", params, call))
      const ids = page.history.flatMap((entry) =>
        (entry.messagesAdded ?? [])
          .filter(
            (added) =>
              !(added.message.labelIds ?? []).some(
                (label) => label === "SENT" || label === "DRAFT"
              )
          )
          .map((added) => added.message.id)
      )
      return {
        messageIds: [...new Set(ids)],
        historyId: page.historyId,
        nextPageToken: page.nextPageToken ?? null,
      }
    },

    async getMetadata(id, call) {
      const params = new URLSearchParams({ format: "metadata" })
      for (const name of ["From", "Subject", "Date"])
        params.append("metadataHeaders", name)
      const message = messageSchema.parse(
        await get(`/messages/${encodeURIComponent(id)}`, params, call)
      )
      const headers = message.payload?.headers ?? []
      const internal = Number(message.internalDate)
      const dated = Date.parse(header(headers, "Date"))
      return {
        id: message.id,
        threadId: message.threadId,
        from: header(headers, "From"),
        subject: header(headers, "Subject"),
        snippet: message.snippet,
        receivedAt: new Date(
          Number.isFinite(internal) && internal > 0
            ? internal
            : Number.isFinite(dated)
              ? dated
              : Date.now()
        ),
      }
    },

    async getBodyText(id, call) {
      const json = (await get(
        `/messages/${encodeURIComponent(id)}`,
        new URLSearchParams({ format: "full" }),
        call
      )) as { payload?: GmailPayloadPart }
      return extractPlainText(json.payload)
    },
  }
}
