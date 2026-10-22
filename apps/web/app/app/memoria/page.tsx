import { getTranslations } from "next-intl/server"

import { NotConfigured } from "@/components/app/not-configured"
import {
  MemoryView,
  type MemoryEventView,
} from "@/components/memory/memory-view"
import { getUserContext } from "@/lib/server/context"
import { getSettingsSnapshot } from "@/lib/settings/server"

/** Memória (RF14.5): every settings change with origin, phrase, diff and status; undo restores. */
export default async function MemoryPage() {
  const t = await getTranslations("Memory")
  const context = await getUserContext()
  if (!context.ok) return <NotConfigured title={t("title")} />
  const { ctx } = context
  const [snapshot, events] = await Promise.all([
    getSettingsSnapshot(ctx),
    ctx.supabase
      .from("memory_events")
      .select(
        "id, intent, origin, utterance, target_type, target_id, before, after, status, created_at"
      )
      .eq("user_id", ctx.user.id)
      .order("created_at", { ascending: false })
      .limit(100),
  ])
  return (
    <MemoryView
      events={(events.data ?? []) as MemoryEventView[]}
      preferences={snapshot.preferences}
      approvalMode={snapshot.approvalMode}
      excludedCompanies={snapshot.excludedCompanies}
    />
  )
}
