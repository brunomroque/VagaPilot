import { randomUUID } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"
import { createEmbedder, type Embedder } from "@vagapilot/ai"
import { matchBlocklist } from "@vagapilot/core/blocklist"
import {
  isSearchDue,
  savedSearchFromRow,
  type SavedSearch,
  type SavedSearchRow,
} from "@vagapilot/core/settings"

import {
  computeMatch,
  loadUserContext,
  POSTING_COLUMNS,
  type MatchDeps,
  type PostingForMatch,
} from "./match.js"

export type SearchDeps = {
  /** service_role; every user-scoped query filters user_id. */
  admin: SupabaseClient
  embedder?: Embedder
  assess?: MatchDeps["assess"]
  searchGmailDuplicates?: MatchDeps["searchGmailDuplicates"]
  now?: () => Date
}

export const SEARCH_RESULT_LIMIT = 20

function escapeLike(value: string): string {
  return value.replace(/[%_\\,()]/g, " ").trim()
}

/**
 * Candidate postings for a search from the shared catalog of public postings
 * (`job_postings`, filled by link ingestion). Only allowed sources; no crawling (RF4A.3).
 */
export async function findPostings(
  admin: SupabaseClient,
  search: SavedSearch,
  now: Date,
  limit = SEARCH_RESULT_LIMIT
): Promise<PostingForMatch[]> {
  let query = admin
    .from("job_postings")
    .select(POSTING_COLUMNS)
    .is("closed_at", null)
  for (const word of escapeLike(search.query)
    .split(/\s+/)
    .filter((part) => part.length >= 2)) {
    query = query.ilike("title", `%${word}%`)
  }
  if (search.seniority) query = query.eq("seniority", search.seniority)
  if (search.workModel) query = query.eq("work_model", search.workModel)
  if (search.regime && search.regime !== "ambos")
    query = query.in("regime", [search.regime, "ambos", "nao_informado"])
  if (search.language) query = query.eq("language", search.language)
  if (search.location && search.workModel !== "remoto") {
    const place = escapeLike(search.location.replace(/^estado de\s+/i, ""))
    if (place) query = query.ilike("location", `%${place}%`)
  }
  if (search.salaryMin !== null)
    query = query.or(`salary_max.is.null,salary_max.gte.${search.salaryMin}`)
  if (search.postedWithinDays !== null) {
    const since = new Date(
      now.getTime() - search.postedWithinDays * 24 * 60 * 60 * 1000
    )
    query = query.gte("posted_at", since.toISOString().slice(0, 10))
  }
  const { data, error } = await query
    .order("fetched_at", { ascending: false })
    .limit(limit * 2)
  if (error) throw new Error(`job_postings search failed: ${error.message}`)
  const excluded = search.excludedCompanies.map((name) => ({
    companyName: name,
  }))
  return ((data ?? []) as unknown as PostingForMatch[])
    .filter(
      (posting) => !matchBlocklist(excluded, { company: posting.company })
    )
    .slice(0, limit)
}

export type SearchPreviewItem = {
  jobPostingId: string
  jobMatchId: string
  title: string
  company: string | null
  location: string | null
  fit: string | null
  blocked: boolean
}

/** Runs the filters and the fit for the first results (form preview and chat card). */
export async function previewSearch(
  deps: SearchDeps,
  userId: string,
  search: SavedSearch,
  limit = 5
): Promise<SearchPreviewItem[]> {
  const now = deps.now?.() ?? new Date()
  const embedder = deps.embedder ?? createEmbedder()
  const context = await loadUserContext(deps.admin, userId)
  const postings = (
    await findPostings(deps.admin, search, now, limit * 2)
  ).filter(
    (posting) =>
      !matchBlocklist(context.blocklist, { company: posting.company })
  )
  const items: SearchPreviewItem[] = []
  for (const posting of postings.slice(0, limit)) {
    const match = await computeMatch(
      {
        admin: deps.admin,
        embedder,
        assess: deps.assess,
        now: deps.now,
        searchGmailDuplicates: deps.searchGmailDuplicates,
      },
      userId,
      posting
    )
    items.push({
      jobPostingId: posting.id,
      jobMatchId: match.matchId,
      title: posting.title,
      company: posting.company,
      location: posting.location,
      fit: match.fit,
      blocked: match.blocked,
    })
  }
  return items
}

export type SearchRunResult = { batchId: string | null; delivered: number }

/**
 * Scheduled run (RF4A.3): new postings since the last delivery become a batch of
 * job_ingestions rows with fit already computed, shown with "Aplicar/Pular".
 */
export async function runSavedSearch(
  deps: SearchDeps,
  input: { userId: string; savedSearchId: string }
): Promise<SearchRunResult> {
  const { data, error } = await deps.admin
    .from("saved_searches")
    .select("*")
    .eq("id", input.savedSearchId)
    .eq("user_id", input.userId)
    .maybeSingle()
  if (error) throw new Error(`saved_searches read failed: ${error.message}`)
  if (!data) throw new Error("Saved search not found for this user")
  const search = savedSearchFromRow(data as SavedSearchRow)
  const now = deps.now?.() ?? new Date()

  const delivered = await deps.admin
    .from("job_ingestions")
    .select("job_posting_id")
    .eq("user_id", input.userId)
    .eq("saved_search_id", input.savedSearchId)
  if (delivered.error)
    throw new Error(`job_ingestions read failed: ${delivered.error.message}`)
  const seen = new Set(
    ((delivered.data ?? []) as { job_posting_id: string | null }[]).map(
      (row) => row.job_posting_id
    )
  )

  const items = (
    await previewSearch(deps, input.userId, search, SEARCH_RESULT_LIMIT)
  ).filter((item) => !seen.has(item.jobPostingId) && !item.blocked)
  const batchId = items.length > 0 ? randomUUID() : null
  if (batchId) {
    const { error: insertError } = await deps.admin
      .from("job_ingestions")
      .insert(
        items.map((item) => ({
          user_id: input.userId,
          batch_id: batchId,
          saved_search_id: input.savedSearchId,
          status: "concluida",
          job_posting_id: item.jobPostingId,
          job_match_id: item.jobMatchId,
        }))
      )
    if (insertError)
      throw new Error(`job_ingestions insert failed: ${insertError.message}`)
  }
  await deps.admin
    .from("saved_searches")
    .update({ last_run_at: now.toISOString() })
    .eq("id", input.savedSearchId)
    .eq("user_id", input.userId)
  return { batchId, delivered: items.length }
}

/** Active searches whose slot passed (cron and the inline fallback). */
export async function dueSearches(
  admin: SupabaseClient,
  now: Date,
  userId?: string
): Promise<{ userId: string; savedSearchId: string }[]> {
  let query = admin.from("saved_searches").select("*").eq("active", true)
  if (userId) query = query.eq("user_id", userId)
  const { data, error } = await query.limit(500)
  if (error) throw new Error(`saved_searches read failed: ${error.message}`)
  return (
    (data ?? []) as (SavedSearchRow & {
      id: string
      user_id: string
      last_run_at: string | null
    })[]
  )
    .filter((row) =>
      isSearchDue(
        savedSearchFromRow(row),
        row.last_run_at ? new Date(row.last_run_at) : null,
        now
      )
    )
    .map((row) => ({ userId: row.user_id, savedSearchId: row.id }))
}
