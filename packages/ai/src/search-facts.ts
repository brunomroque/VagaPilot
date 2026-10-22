import { isUsableFact } from "@vagapilot/core/facts"

import type { Embedder } from "./embeddings.js"

export type FactSearchHit = {
  id: string
  experienceId: string | null
  statement: string
  kind: string
  tags: string[]
  status: string
  similarity: number
}

/** Storage port: must already restrict to `status = 'confirmado'` (SQL function). */
export type FactSearchStore = {
  searchConfirmed(
    userId: string,
    embedding: readonly number[],
    k: number
  ): Promise<FactSearchHit[]>
}

export type SearchFacts = (
  userId: string,
  query: string,
  k?: number
) => Promise<FactSearchHit[]>

export const DEFAULT_SEARCH_K = 8
export const MAX_SEARCH_K = 50

/**
 * `search_facts(query, k)` for the agent (10.2). ALWAYS confirmed-only: the store filters in
 * SQL and this layer filters again, so a proposed or rejected fact can never be returned.
 */
export function createFactSearch(deps: {
  embedder: Embedder
  store: FactSearchStore
}): SearchFacts {
  return async (userId, query, k = DEFAULT_SEARCH_K) => {
    const trimmed = query.trim()
    if (!trimmed) return []
    const limit = Math.min(Math.max(Math.trunc(k), 1), MAX_SEARCH_K)
    const embedding = await deps.embedder.embed(trimmed)
    const hits = await deps.store.searchConfirmed(userId, embedding, limit)
    return hits.filter(isUsableFact).slice(0, limit)
  }
}
