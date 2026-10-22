import type { SupabaseClient } from "@supabase/supabase-js"
import type { AuditRecord, AuditSink } from "@vagapilot/core/audit"

/**
 * `AuditSink` that appends to `public.audit_log` (append-only, 10.7). Records arrive
 * already redacted by `logAudit`. Use a service_role client so workers can write too.
 */
export class SupabaseAuditSink implements AuditSink {
  constructor(private readonly client: SupabaseClient) {}

  async write(record: AuditRecord): Promise<void> {
    if (!record.userId) {
      throw new Error(
        "audit_log requires a user_id; global events are not stored here"
      )
    }
    const { error } = await this.client.from("audit_log").insert({
      user_id: record.userId,
      actor: record.actor,
      action: record.action,
      target_type: record.targetType,
      target_id: record.targetId,
      approval_id: record.approvalId,
      details: record.details,
      ip: record.ip,
      user_agent: record.userAgent,
      created_at: record.occurredAt.toISOString(),
    })
    if (error) throw new Error(`audit_log insert failed: ${error.message}`)
  }
}
