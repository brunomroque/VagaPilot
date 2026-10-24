import "server-only"

import type { UIMessage } from "ai"

import type { UserContext } from "@/lib/server/context"

/** Conversations and messages (9.3, RF7.3): one default "Busca de emprego" conversation. */

export const DEFAULT_CONVERSATION_TITLE = "Busca de emprego"
export const HISTORY_LIMIT = 60

export type ConversationRow = {
  id: string
  title: string | null
  created_at: string
  updated_at?: string | null
  archived_at?: string | null
  last_message_at?: string | null
}

export async function findConversation(
  ctx: UserContext,
  id: string
): Promise<ConversationRow | null> {
  const { data, error } = await ctx.supabase
    .from("conversations")
    .select("id, title, created_at")
    .eq("id", id)
    .eq("user_id", ctx.user.id)
    .maybeSingle()
  if (error) throw new Error(`conversations read failed: ${error.message}`)
  return data as ConversationRow | null
}

/** The latest conversation, or a new default one. */
export async function defaultConversation(
  ctx: UserContext
): Promise<ConversationRow> {
  const { data, error } = await ctx.supabase
    .from("conversations")
    .select("id, title, created_at")
    .eq("user_id", ctx.user.id)
    .order("created_at", { ascending: false })
    .limit(1)
  if (error) throw new Error(`conversations read failed: ${error.message}`)
  const latest = (data as ConversationRow[])[0]
  return latest ?? createConversation(ctx)
}

export async function createConversation(
  ctx: UserContext,
  id?: string
): Promise<ConversationRow> {
  const { data, error } = await ctx.supabase
    .from("conversations")
    .insert({
      ...(id ? { id } : {}),
      user_id: ctx.user.id,
      title: DEFAULT_CONVERSATION_TITLE,
    })
    .select("id, title, created_at")
    .single()
  if (error || !data)
    throw new Error(`conversations insert failed: ${error?.message}`)
  return data as ConversationRow
}

/** Existing conversation of this user, or a new one with that id. Never another user's. */
export async function ensureConversation(
  ctx: UserContext,
  id: string
): Promise<ConversationRow> {
  return (await findConversation(ctx, id)) ?? createConversation(ctx, id)
}

type MessageRow = {
  id: string
  role: UIMessage["role"]
  parts: UIMessage["parts"]
  created_at: string
}

export async function loadUIMessages(
  ctx: UserContext,
  conversationId: string,
  limit = HISTORY_LIMIT
): Promise<UIMessage[]> {
  const { data, error } = await ctx.supabase
    .from("messages")
    .select("id, role, parts, created_at")
    .eq("user_id", ctx.user.id)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(limit)
  if (error) throw new Error(`messages read failed: ${error.message}`)
  return (data as MessageRow[])
    .reverse()
    .map((row) => ({ id: row.id, role: row.role, parts: row.parts }))
}

export async function saveMessage(
  ctx: UserContext,
  conversationId: string,
  message: Pick<UIMessage, "role" | "parts">
): Promise<string> {
  const { data, error } = await ctx.supabase
    .from("messages")
    .insert({
      user_id: ctx.user.id,
      conversation_id: conversationId,
      role: message.role,
      parts: message.parts,
    })
    .select("id")
    .single()
  if (error || !data)
    throw new Error(`messages insert failed: ${error?.message}`)
  const messageId = String((data as { id: string }).id)
  const now = new Date().toISOString()
  await ctx.supabase
    .from("conversations")
    .update({ updated_at: now, last_message_at: now })
    .eq("id", conversationId)
    .eq("user_id", ctx.user.id)
  return messageId
}

export async function listConversations(
  ctx: UserContext,
  includeArchived = false
): Promise<ConversationRow[]> {
  let query = ctx.supabase
    .from("conversations")
    .select("id, title, created_at, updated_at, archived_at, last_message_at")
    .eq("user_id", ctx.user.id)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
  if (!includeArchived) {
    query = query.is("archived_at", null)
  }
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data ?? []) as ConversationRow[]
}

export async function archiveConversation(
  ctx: UserContext,
  conversationId: string
): Promise<void> {
  const { error } = await ctx.supabase
    .from("conversations")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", conversationId)
    .eq("user_id", ctx.user.id)
  if (error) throw new Error(error.message)
}

/** Messages the user sent in the last minute (rate limit, CA14.10). */
export async function recentUserMessageCount(
  ctx: UserContext,
  windowMs: number
): Promise<number> {
  const since = new Date(Date.now() - windowMs).toISOString()
  const { count, error } = await ctx.supabase
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("user_id", ctx.user.id)
    .eq("role", "user")
    .gte("created_at", since)
  if (error) throw new Error(`messages count failed: ${error.message}`)
  return count ?? 0
}

/** Names a conversation after its first message (QA: every chat was "Busca de emprego"). */
export async function titleConversation(
  ctx: UserContext,
  conversationId: string,
  parts: UIMessage["parts"]
): Promise<void> {
  let title = ""
  for (const part of parts as {
    type: string
    text?: string
    data?: unknown
  }[]) {
    if (part.type === "text" && part.text?.trim()) {
      title = part.text.trim()
      break
    }
  }
  if (!title || title === "Segue anexo.") {
    const names = JSON.stringify(parts).match(/"name":"([^"]{1,80})"/)
    title = names?.[1] ?? title
  }
  title = title.replace(/\s+/g, " ").slice(0, 60).trim()
  if (!title) return
  await ctx.supabase
    .from("conversations")
    .update({ title })
    .eq("id", conversationId)
    .eq("user_id", ctx.user.id)
    .eq("title", DEFAULT_CONVERSATION_TITLE)
}
