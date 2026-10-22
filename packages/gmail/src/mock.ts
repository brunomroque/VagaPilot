import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { z } from "zod"

import { GmailApiError, type GmailApi, type GmailMessageMeta } from "./api.js"
import type { GoogleOAuthClient, RevokeResult, TokenGrant } from "./oauth.js"

/**
 * FIXTURE GMAIL BACKEND — tests and local dev only (VAGAPILOT_GMAIL_MOCK=1, never in production).
 * Messages are fictitious. The API honours `newer_than:Nd` and history ids; any other search
 * term is left to the deterministic prefilter, exactly as with incremental history entries.
 */

export const fixtureMessageSchema = z.object({
  id: z.string().min(1).max(100),
  threadId: z.string().min(1).max(100).optional(),
  from: z.string().min(3).max(300),
  subject: z.string().max(300),
  /** ISO-8601. */
  date: z.string(),
  body: z.string().max(20_000),
  historyId: z.number().int().positive().optional(),
})

export type FixtureMessage = z.infer<typeof fixtureMessageSchema>

export type StoredMailbox = {
  messages: (FixtureMessage & { historyId: number })[]
  historyId: number
}

/** Where a fixture mailbox lives. Tests keep it in memory; dev shares it via a temp file. */
export interface MailboxSource {
  read(userId: string): Promise<StoredMailbox>
  write(userId: string, mailbox: StoredMailbox): Promise<void>
  clear(userId: string): Promise<void>
}

const EMPTY: StoredMailbox = { messages: [], historyId: 1 }

export function createMemoryMailboxSource(): MailboxSource {
  const boxes = new Map<string, StoredMailbox>()
  return {
    async read(userId) {
      return boxes.get(userId) ?? { ...EMPTY, messages: [] }
    },
    async write(userId, mailbox) {
      boxes.set(userId, mailbox)
    },
    async clear(userId) {
      boxes.delete(userId)
    },
  }
}

const storedSchema = z.object({
  messages: z.array(
    fixtureMessageSchema.extend({ historyId: z.number().int().positive() })
  ),
  historyId: z.number().int().positive(),
})

/** One JSON file per user under the OS temp dir (shared by route handlers and server actions). */
export function createFileMailboxSource(
  directory = join(tmpdir(), "vagapilot-gmail-mock")
) {
  const fileFor = (userId: string) =>
    join(directory, `${userId.replace(/[^a-zA-Z0-9-]/g, "")}.json`)
  const source: MailboxSource = {
    async read(userId) {
      try {
        const parsed = storedSchema.safeParse(
          JSON.parse(await readFile(fileFor(userId), "utf8"))
        )
        return parsed.success ? parsed.data : { ...EMPTY, messages: [] }
      } catch {
        return { ...EMPTY, messages: [] }
      }
    },
    async write(userId, mailbox) {
      await mkdir(directory, { recursive: true })
      await writeFile(fileFor(userId), JSON.stringify(mailbox), "utf8")
    },
    async clear(userId) {
      await rm(fileFor(userId), { force: true })
    },
  }
  return source
}

/** Appends messages as new history entries (like mail arriving). Replaces ids already present. */
export async function deliverFixtureMessages(
  source: MailboxSource,
  userId: string,
  messages: readonly FixtureMessage[],
  options: { replace?: boolean } = {}
): Promise<StoredMailbox> {
  const current = options.replace
    ? { ...EMPTY, messages: [] }
    : await source.read(userId)
  let historyId = current.historyId
  const incoming = new Map(messages.map((message) => [message.id, message]))
  const kept = current.messages.filter((message) => !incoming.has(message.id))
  const added = messages.map((message) => {
    historyId += 1
    return { ...message, historyId }
  })
  const next = { messages: [...kept, ...added], historyId }
  await source.write(userId, next)
  return next
}

export type FixtureGmailApi = GmailApi & {
  /** Ids whose body was read (to prove filtered-out mail is never opened). */
  readonly openedBodies: string[]
}

function newerThanDays(query: string): number | null {
  const match = /newer_than:(\d+)d/.exec(query)
  return match ? Number(match[1]) : null
}

export function createFixtureGmailApi(options: {
  source: MailboxSource
  userId: string
  emailAddress: string
  now?: () => Date
  /** Called before each call; tests use it to revoke mid-sync. */
  onCall?: (method: keyof GmailApi, id?: string) => Promise<void> | void
}): FixtureGmailApi {
  const now = options.now ?? (() => new Date())
  const openedBodies: string[] = []

  async function messages() {
    return (await options.source.read(options.userId)).messages
  }

  async function find(id: string) {
    const message = (await messages()).find((item) => item.id === id)
    if (!message) throw new GmailApiError("not_found", 404)
    return message
  }

  function toMeta(message: FixtureMessage): GmailMessageMeta {
    return {
      id: message.id,
      threadId: message.threadId ?? message.id,
      from: message.from,
      subject: message.subject,
      snippet: message.body.replace(/\s+/g, " ").trim().slice(0, 200),
      receivedAt: new Date(message.date),
    }
  }

  return {
    openedBodies,
    async getProfile() {
      await options.onCall?.("getProfile")
      const mailbox = await options.source.read(options.userId)
      return {
        emailAddress: options.emailAddress,
        historyId: String(mailbox.historyId),
      }
    },
    async listMessages(query) {
      await options.onCall?.("listMessages")
      const days = newerThanDays(query)
      const cutoff = days === null ? null : now().getTime() - days * 86_400_000
      const list = (await messages())
        .filter(
          (message) => cutoff === null || Date.parse(message.date) >= cutoff
        )
        .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
        .map((message) => ({
          id: message.id,
          threadId: message.threadId ?? message.id,
        }))
      return { messages: list, nextPageToken: null }
    },
    async listHistory(startHistoryId) {
      await options.onCall?.("listHistory")
      const mailbox = await options.source.read(options.userId)
      const start = Number(startHistoryId)
      if (!Number.isFinite(start))
        throw new GmailApiError("history_expired", 404)
      return {
        messageIds: mailbox.messages
          .filter((message) => message.historyId > start)
          .map((m) => m.id),
        historyId: String(mailbox.historyId),
        nextPageToken: null,
      }
    },
    async getMetadata(id) {
      await options.onCall?.("getMetadata", id)
      return toMeta(await find(id))
    },
    async getBodyText(id) {
      await options.onCall?.("getBodyText", id)
      openedBodies.push(id)
      return (await find(id)).body
    },
  }
}

/**
 * Mock Google consent: the authorization URL points straight back to our callback, the code
 * exchange returns a fictitious refresh token and revocation is recorded in memory.
 */
export function createMockOAuthClient(
  options: { now?: () => Date } = {}
): GoogleOAuthClient & {
  readonly revoked: string[]
} {
  const now = options.now ?? (() => new Date())
  const revoked: string[] = []
  return {
    revoked,
    authorizationUrl(request) {
      const url = new URL(request.redirectUri)
      url.searchParams.set(
        "code",
        `mock-code:${encodeURIComponent(request.scope)}`
      )
      url.searchParams.set("state", request.state)
      url.searchParams.set("scope", request.scope)
      return url.toString()
    },
    async exchangeCode(code): Promise<TokenGrant> {
      const scope = decodeURIComponent(code.replace(/^mock-code:/, ""))
      return {
        accessToken: "mock-access-token",
        expiresAt: new Date(now().getTime() + 3_600_000),
        refreshToken: `mock-refresh-${now().getTime()}`,
        scopes: scope.split(/\s+/).filter(Boolean),
      }
    },
    async refreshAccessToken() {
      return {
        accessToken: "mock-access-token",
        expiresAt: new Date(now().getTime() + 3_600_000),
      }
    },
    async revoke(token): Promise<RevokeResult> {
      revoked.push(token)
      return "revoked"
    },
  }
}
