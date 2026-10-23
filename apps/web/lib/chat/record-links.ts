import "server-only"

import type { UserContext } from "@/lib/server/context"

export async function linkChatRecord(
  ctx: UserContext,
  input: {
    conversationId: string
    messageId?: string | null
    tableName: string
    recordId: string
    action: "created" | "updated"
  }
): Promise<void> {
  const { error } = await ctx.supabase.from("chat_record_links").insert({
    user_id: ctx.user.id,
    conversation_id: input.conversationId,
    message_id: input.messageId ?? null,
    table_name: input.tableName,
    record_id: input.recordId,
    action: input.action,
  })
  if (error)
    throw new Error(`chat_record_links insert failed: ${error.message}`)
}

export async function findChatProvenance(
  ctx: UserContext,
  tableName: string,
  recordId: string
): Promise<{ conversationId: string; linkId: string } | null> {
  const { data, error } = await ctx.supabase
    .from("chat_record_links")
    .select("id, conversation_id")
    .eq("user_id", ctx.user.id)
    .eq("table_name", tableName)
    .eq("record_id", recordId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  const row = data as { id: string; conversation_id: string }
  return { conversationId: row.conversation_id, linkId: row.id }
}
