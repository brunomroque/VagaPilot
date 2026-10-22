import type {
  ApplicationRoute as DbApplicationRoute,
  ApplicationStatus as DbApplicationStatus,
  ContractRegime as DbContractRegime,
  EventSource as DbEventSource,
  FitLevel as DbFitLevel,
  JobSource as DbJobSource,
} from "@vagapilot/db"
import type { ApplicationStatus, EventSource } from "@vagapilot/core/status"
import type {
  ApplicationRoute,
  ContractRegime,
  FitLevel,
  JobSource,
  TrackerApplication,
} from "@vagapilot/core/tracker"

import type { NotificationItem } from "@/lib/gmail/types"

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false

/** Compile-time guard: the core enums must match the Drizzle/Postgres enums. */
export const enumsInSync: [
  Equal<ApplicationStatus, DbApplicationStatus>,
  Equal<EventSource, DbEventSource>,
  Equal<JobSource, DbJobSource>,
  Equal<ApplicationRoute, DbApplicationRoute>,
  Equal<FitLevel, DbFitLevel>,
  Equal<ContractRegime, DbContractRegime>,
] = [true, true, true, true, true, true]

export type { TrackerApplication }
export type { NotificationItem }

export type CvOption = { id: string; label: string; track: string | null }

export type GmailStatus = {
  status: string
  lastSyncedAt: string | null
  googleEmail: string
  /** E-mails waiting in the "Revise" queue. */
  reviewCount: number
}

export type TrackerData = {
  applications: TrackerApplication[]
  cvVersions: CvOption[]
  gmail: GmailStatus | null
  /** Topbar bell (P4.3). */
  notifications: NotificationItem[]
  loadError: boolean
}

export const TIMELINE_EVENT_TYPES = [
  "status_change",
  "note",
  "question_answered",
  "email_linked",
  "evidence_added",
  "deadline_set",
] as const

export type TimelineEventType = (typeof TIMELINE_EVENT_TYPES)[number]

export type TimelineEvent = {
  id: string
  type: TimelineEventType
  fromStatus: ApplicationStatus | null
  toStatus: ApplicationStatus | null
  source: EventSource
  confidence: number | null
  occurredAt: string
  action: string | null
  dueAt: string | null
  done: boolean
  created: boolean
  imported: boolean
  emailSubject: string | null
  hasEvidence: boolean
}

export type EvidenceItem = {
  id: string
  kind: string
  textExcerpt: string | null
  url: string | null
  /** Signed URL (5 min) for images stored in the private `evidences` bucket. */
  imageUrl: string | null
  createdAt: string
}

export type ApplicationDetail = {
  events: TimelineEvent[]
  evidences: EvidenceItem[]
}

export type ActionErrorCode =
  | "unauthorized"
  | "invalid_request"
  | "invalid_transition"
  | "status_conflict"
  | "not_found"
  | "not_configured"
  | "no_pending_action"
  | "internal_error"

export type ActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; error: { code: ActionErrorCode; message: string } }
