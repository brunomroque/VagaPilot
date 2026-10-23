import { redactPII, redactPIIText } from "./redact.js"

/** Append-only audit trail (spec 9 `audit_log`, 10.7). Details never carry PII in clear. */

export const AUDIT_ACTORS = [
  "usuario",
  "agente",
  "extensao",
  "worker",
  "sistema",
  "suporte",
] as const

export type AuditActor = (typeof AUDIT_ACTORS)[number]

export const AUDIT_ACTIONS = [
  "fact.proposed",
  "fact.confirmed",
  "fact.rejected",
  "cv.uploaded",
  "cv.generated",
  "job.ingested",
  "match.created",
  "decision.recorded",
  "package.created",
  "package.consumed",
  "form.field_filled",
  "question.asked",
  "question.answered",
  "approval.requested",
  "approval.approved",
  "approval.rejected",
  "approval.expired",
  "email.sent",
  "application.submitted",
  "status.changed",
  "gmail.connected",
  "gmail.revoked",
  "gmail.synced",
  "data.exported",
  "account.deletion_requested",
  "account.deletion_cancelled",
  "settings.changed",
  "settings.undone",
  "search.created",
  "search.updated",
  "search.deleted",
  "chat.off_topic_refused",
  "chat.injection_blocked",
  "ratelimit.hit",
  "killswitch.toggled",
  "risk.accepted",
  "risk.revoked",
  "risk.reconsent_required",
] as const

export type AuditAction = (typeof AUDIT_ACTIONS)[number]

const ACTOR_SET: ReadonlySet<string> = new Set(AUDIT_ACTORS)
const ACTION_SET: ReadonlySet<string> = new Set(AUDIT_ACTIONS)

export function isAuditActor(value: string): value is AuditActor {
  return ACTOR_SET.has(value)
}

export function isAuditAction(value: string): value is AuditAction {
  return ACTION_SET.has(value)
}

export interface AuditEventInput {
  /** Null only for global events (e.g. `job.ingested`, `killswitch.toggled`). */
  userId: string | null
  actor: AuditActor
  action: AuditAction
  targetType?: string
  targetId?: string
  approvalId?: string
  details?: Record<string, unknown>
  ip?: string
  userAgent?: string
}

export interface AuditRecord {
  userId: string | null
  actor: AuditActor
  action: AuditAction
  targetType: string | null
  targetId: string | null
  approvalId: string | null
  details: Record<string, unknown>
  ip: string | null
  userAgent: string | null
  occurredAt: Date
}

export interface AuditSink {
  write(record: AuditRecord): Promise<void>
}

export class InMemoryAuditSink implements AuditSink {
  readonly records: AuditRecord[] = []

  async write(record: AuditRecord): Promise<void> {
    this.records.push(record)
  }
}

function optionalText(value: string | undefined): string | null {
  return value === undefined ? null : redactPIIText(value)
}

/** Validates, redacts and writes one audit event. Returns the stored record. */
export async function logAudit(
  sink: AuditSink,
  event: AuditEventInput
): Promise<AuditRecord> {
  if (!isAuditActor(event.actor)) {
    throw new Error(`Unknown audit actor: ${String(event.actor)}`)
  }
  if (!isAuditAction(event.action)) {
    throw new Error(`Unknown audit action: ${String(event.action)}`)
  }

  const details = redactPII(event.details ?? {}) as Record<string, unknown>
  const record: AuditRecord = {
    userId: event.userId,
    actor: event.actor,
    action: event.action,
    targetType: optionalText(event.targetType),
    targetId: optionalText(event.targetId),
    approvalId: event.approvalId ?? null,
    details,
    ip: event.ip ?? null,
    userAgent: optionalText(event.userAgent),
    occurredAt: new Date(),
  }
  await sink.write(record)
  return record
}

export type AuditLogger = (event: AuditEventInput) => Promise<AuditRecord>

export function createAuditLogger(sink: AuditSink): AuditLogger {
  return (event) => logAudit(sink, event)
}
