import type { CurrentUser } from "@/lib/auth/session"
import { loadGmailShellData } from "@/lib/gmail/queries"
import { createSupabaseServerClient } from "@/lib/supabase/server"

import { listApplications, listCvOptions } from "./queries"
import type { TrackerData } from "./types"

/** Loads the tracker for the /app layout. Every read runs under the user's RLS session. */
export async function loadTrackerData(user: CurrentUser): Promise<TrackerData> {
  const supabase = await createSupabaseServerClient()
  if (!supabase) {
    return {
      applications: [],
      cvVersions: [],
      gmail: null,
      notifications: [],
      loadError: !user.isDevBypass,
    }
  }
  const [applications, cvVersions, gmail] = await Promise.all([
    listApplications(supabase),
    listCvOptions(supabase),
    loadGmailShellData(supabase),
  ])
  return {
    applications: applications ?? [],
    cvVersions,
    gmail: gmail.connection
      ? {
          status: gmail.connection.status,
          lastSyncedAt: gmail.connection.lastSyncedAt,
          googleEmail: gmail.connection.googleEmail,
          reviewCount: gmail.reviewCount,
        }
      : null,
    notifications: gmail.notifications,
    loadError: applications === null,
  }
}
