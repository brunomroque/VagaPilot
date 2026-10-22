import type { SupabaseClient } from "@supabase/supabase-js"
import { getTranslations } from "next-intl/server"

import { logAudit, type AuditEventInput } from "@vagapilot/core/audit"
import {
  APPLICATION_STATUSES,
  type ApplicationStatus,
} from "@vagapilot/core/status"
import {
  APPLICATION_ROUTES,
  CONTRACT_REGIMES,
  JOB_SOURCES,
  type ApplicationRoute,
  type ContractRegime,
  type JobSource,
} from "@vagapilot/core/tracker"
import {
  EXPORT_COLUMNS,
  type ImportLabels,
  type TrackerCsvLabels,
} from "@vagapilot/core/tracker-csv"
import { SupabaseAuditSink } from "@vagapilot/db/server"

import { getCurrentUser, type CurrentUser } from "@/lib/auth/session"
import { createSupabaseServerClient } from "@/lib/supabase/server"

/** Server-only helpers shared by the tracker server actions and route handlers. */

export type TrackerSession = { user: CurrentUser; supabase: SupabaseClient }

export async function getTrackerSession(): Promise<
  TrackerSession | { error: "unauthorized" | "not_configured" }
> {
  const user = await getCurrentUser()
  if (!user) return { error: "unauthorized" }
  const supabase = await createSupabaseServerClient()
  if (!supabase) return { error: "not_configured" }
  return { user, supabase }
}

/** Appends to audit_log through the user's session. A failed audit write is logged, never thrown. */
export async function audit(
  supabase: SupabaseClient,
  event: AuditEventInput
): Promise<void> {
  try {
    await logAudit(new SupabaseAuditSink(supabase), event)
  } catch (error) {
    console.error("audit write failed", {
      action: event.action,
      reason: error instanceof Error ? error.name : "unknown",
    })
  }
}

function labelMap<T extends string>(
  values: readonly T[],
  label: (value: T) => string
): Record<T, string> {
  return Object.fromEntries(
    values.map((value) => [value, label(value)])
  ) as Record<T, string>
}

export async function getTrackerLabels(): Promise<
  TrackerCsvLabels & ImportLabels
> {
  const tStatus = await getTranslations("Status")
  const t = await getTranslations("Tracker")
  return {
    headers: labelMap(EXPORT_COLUMNS, (column) =>
      t(`export.columns.${column}`)
    ),
    status: labelMap<ApplicationStatus>(APPLICATION_STATUSES, (status) =>
      tStatus(status)
    ),
    source: labelMap<JobSource>(JOB_SOURCES, (source) =>
      t(`sources.${source}`)
    ),
    route: labelMap<ApplicationRoute>(APPLICATION_ROUTES, (route) =>
      t(`routes.${route}`)
    ),
    regime: labelMap<ContractRegime>(CONTRACT_REGIMES, (regime) =>
      t(`regimes.${regime}`)
    ),
  }
}
