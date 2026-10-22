import "server-only"

import { getAdminClient } from "@/lib/server/admin"
import { audit } from "@/lib/server/audit"

const PURGE_DAYS = 15

export async function requestAccountDeletion(userId: string): Promise<Date> {
  const admin = getAdminClient()
  if (!admin) throw new Error("admin_not_configured")
  const scheduled = new Date(Date.now() + PURGE_DAYS * 24 * 60 * 60 * 1000)
  await admin.from("account_deletion_requests").upsert({
    user_id: userId,
    requested_at: new Date().toISOString(),
    scheduled_purge_at: scheduled.toISOString(),
    status: "pending",
  })
  await audit({
    userId,
    actor: "usuario",
    action: "account.deletion_requested",
    targetType: "user",
    targetId: userId,
    details: { scheduled_purge_at: scheduled.toISOString() },
  })
  return scheduled
}
