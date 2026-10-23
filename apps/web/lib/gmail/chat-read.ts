import "server-only"

import type { UserContext } from "@/lib/server/context"

export type GmailThreadSummary = {
  id: string
  subject: string
  snippet: string
  receivedAt: string | null
}

/** Read-only Gmail summaries for chat (spec 4.2). */
export async function summarizeGmailThreads(
  ctx: UserContext,
  input: {
    applicationId?: string
    query?: string
    limit?: number
  }
): Promise<GmailThreadSummary[]> {
  const limit = input.limit ?? 5
  let query = ctx.supabase
    .from("email_threads")
    .select("id, subject, snippet, received_at, application_id")
    .eq("user_id", ctx.user.id)
    .order("received_at", { ascending: false })
    .limit(limit)
  if (input.applicationId) {
    query = query.eq("application_id", input.applicationId)
  }
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (
    (data ?? []) as {
      id: string
      subject: string
      snippet: string
      received_at: string
    }[]
  ).map((row) => ({
    id: row.id,
    subject: row.subject,
    snippet: row.snippet?.slice(0, 500) ?? "",
    receivedAt: row.received_at,
  }))
}
