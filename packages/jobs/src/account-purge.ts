import type { SupabaseClient } from "@supabase/supabase-js"
import { createFieldCrypto, keyProviderFromEnv } from "@vagapilot/core/crypto"
import { createGmailRuntime, revokeGmailConnection } from "@vagapilot/gmail"
import { SupabaseAuditSink, SupabaseDekStore } from "@vagapilot/db/server"

import { createAdminClient } from "./deps.js"

export async function purgeUserAccount(userId: string): Promise<void> {
  const admin = createAdminClient()
  const fieldCrypto = createFieldCrypto({
    keyProvider: keyProviderFromEnv(),
    dekStore: new SupabaseDekStore(admin),
  })
  const runtime = createGmailRuntime({
    admin,
    fieldCrypto,
    audit: new SupabaseAuditSink(admin),
  })
  await revokeGmailConnection(runtime, userId, { actor: "sistema" })
  await fieldCrypto.destroyUserKey(userId)
  await admin.auth.admin.deleteUser(userId)
  await admin
    .from("account_deletion_requests")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("user_id", userId)
}

export async function listDueDeletions(
  admin: SupabaseClient
): Promise<string[]> {
  const now = new Date().toISOString()
  const { data } = await admin
    .from("account_deletion_requests")
    .select("user_id")
    .eq("status", "pending")
    .lte("scheduled_purge_at", now)
  return ((data ?? []) as { user_id: string }[]).map((row) => row.user_id)
}
