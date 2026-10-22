import type { SupabaseClient } from "@supabase/supabase-js"

export type ConfirmedFactHit = {
  id: string
  experienceId: string | null
  statement: string
  statementEn: string | null
  kind: string
  tags: string[]
  status: "confirmado"
  similarity: number
}

type SearchRow = {
  id: string
  experience_id: string | null
  statement: string
  statement_en: string | null
  kind: string
  tags: string[] | null
  status: string
  similarity: number
}

/**
 * Calls `public.search_confirmed_facts`, which filters `status = 'confirmado'` in SQL.
 * Rows are filtered again here so a future change to the function cannot leak proposals.
 */
export async function searchConfirmedFacts(
  client: SupabaseClient,
  userId: string,
  embedding: readonly number[],
  k: number
): Promise<ConfirmedFactHit[]> {
  const { data, error } = await client.rpc("search_confirmed_facts", {
    p_user_id: userId,
    p_query: JSON.stringify(embedding),
    p_k: k,
  })
  if (error) throw new Error(`search_confirmed_facts failed: ${error.message}`)
  return ((data ?? []) as SearchRow[])
    .filter((row) => row.status === "confirmado")
    .map((row) => ({
      id: row.id,
      experienceId: row.experience_id,
      statement: row.statement,
      statementEn: row.statement_en,
      kind: row.kind,
      tags: row.tags ?? [],
      status: "confirmado" as const,
      similarity: row.similarity,
    }))
}
