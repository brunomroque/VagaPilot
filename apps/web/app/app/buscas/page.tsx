import { getTranslations } from "next-intl/server"

import { NotConfigured } from "@/components/app/not-configured"
import {
  SearchesView,
  type SearchView,
} from "@/components/searches/searches-view"
import type { IngestItem } from "@/lib/chat/types"
import { getAdminClient } from "@/lib/server/admin"
import { getUserContext } from "@/lib/server/context"
import { getSettingsSnapshot } from "@/lib/settings/server"
import {
  dueSearches,
  isInngestConfigured,
  runSavedSearch,
} from "@vagapilot/jobs"

const CV_LANGUAGE_LABEL: Record<string, string> = {
  "pt-BR": "PT",
  en: "EN",
  es: "ES",
}

/** Without Inngest, due searches run when the user opens the page (inline fallback of the cron). */
async function runDueInline(userId: string) {
  const admin = getAdminClient()
  if (!admin || isInngestConfigured()) return
  try {
    for (const item of (await dueSearches(admin, new Date(), userId)).slice(
      0,
      3
    )) {
      await runSavedSearch({ admin }, item)
    }
  } catch (error) {
    console.error("saved search inline run failed", {
      reason: error instanceof Error ? error.message : "unknown",
    })
  }
}

export default async function SavedSearchesPage() {
  const t = await getTranslations("Searches")
  const context = await getUserContext()
  if (!context.ok) return <NotConfigured title={t("title")} />
  const { ctx } = context
  await runDueInline(ctx.user.id)

  const [snapshot, batches, versions] = await Promise.all([
    getSettingsSnapshot(ctx),
    ctx.supabase
      .from("job_ingestions")
      .select(
        "id, batch_id, saved_search_id, input_url, status, error_code, job_match_id, created_at"
      )
      .eq("user_id", ctx.user.id)
      .not("saved_search_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(200),
    ctx.supabase
      .from("cv_versions")
      .select("id, label, language")
      .eq("user_id", ctx.user.id)
      .order("label"),
  ])

  const latest = new Map<string, { batchId: string; items: IngestItem[] }>()
  for (const row of (batches.data ?? []) as {
    id: string
    batch_id: string
    saved_search_id: string
    input_url: string | null
    status: IngestItem["status"]
    error_code: string | null
    job_match_id: string | null
  }[]) {
    const current = latest.get(row.saved_search_id)
    if (current && current.batchId !== row.batch_id) continue
    const item = {
      ingestionId: row.id,
      url: row.input_url,
      status: row.status,
      errorCode: row.error_code,
      jobMatchId: row.job_match_id,
    }
    if (current) current.items.push(item)
    else
      latest.set(row.saved_search_id, { batchId: row.batch_id, items: [item] })
  }

  const searches: SearchView[] = snapshot.savedSearches.map((search) => ({
    ...search,
    latestBatch: latest.get(search.id) ?? null,
  }))
  const cvOptions = (
    (versions.data ?? []) as { id: string; label: string; language: string }[]
  ).map((cv) => ({
    id: cv.id,
    label: `${cv.label} · ${CV_LANGUAGE_LABEL[cv.language] ?? cv.language}`,
  }))

  return <SearchesView searches={searches} cvOptions={cvOptions} />
}
