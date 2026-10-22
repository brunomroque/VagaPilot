import "server-only"

import {
  logAudit,
  type AuditEventInput,
  type AuditRecord,
} from "@vagapilot/core/audit"
import { SupabaseAuditSink } from "@vagapilot/db/server"
import { headers } from "next/headers"

import { getAdminClient } from "./admin"

/** Writes one redacted `audit_log` entry (10.7) with the request's user agent. */
export async function audit(
  event: Omit<AuditEventInput, "userAgent" | "ip">
): Promise<AuditRecord> {
  const admin = getAdminClient()
  if (!admin) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured")
  const headerList = await headers()
  return logAudit(new SupabaseAuditSink(admin), {
    ...event,
    userAgent: headerList.get("user-agent") ?? undefined,
  })
}
