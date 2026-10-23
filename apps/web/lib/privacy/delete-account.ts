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

export async function cancelAccountDeletion(userId: string): Promise<boolean> {
  const admin = getAdminClient()
  if (!admin) throw new Error("admin_not_configured")
  const { data, error } = await admin
    .from("account_deletion_requests")
    .update({ status: "cancelled" })
    .eq("user_id", userId)
    .eq("status", "pending")
    .select("user_id")
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return false
  await audit({
    userId,
    actor: "usuario",
    action: "account.deletion_cancelled",
    targetType: "user",
    targetId: userId,
  })
  return true
}
