import type { EmailClass } from "@vagapilot/core/email"
import type { ReviewReason } from "@vagapilot/core/email-outcome"
import type { ApplicationStatus } from "@vagapilot/core/status"

/** Client-safe shapes of the Gmail integration (no tokens, no bodies). */

export type GmailMode = "google" | "mock" | "unconfigured"

export type GmailConnectionView = {
  googleEmail: string
  canRead: boolean
  canSend: boolean
  status: "ativo" | "erro" | "revogado"
  lastSyncedAt: string | null
  connectedAt: string | null
  lastError: string | null
}

export type ReviewItem = {
  id: string
  fromAddress: string | null
  subject: string
  receivedAt: string
  snippet: string
  classification: EmailClass
  confidence: number | null
  suggestedStatus: ApplicationStatus | null
  reason: ReviewReason | null
  deadline: string | null
  interviewAt: string | null
  application: {
    id: string
    company: string
    roleTitle: string
    status: ApplicationStatus
  } | null
  /** The application was created from this e-mail (RF11.7). */
  createdFromEmail: boolean
}

export const NOTIFICATION_KINDS = [
  "status_changed",
  "review_needed",
  "deadline_reminder",
  "gmail_error",
] as const

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number]

export type NotificationItem = {
  id: string
  kind: NotificationKind
  params: Record<string, string | number | null>
  applicationId: string | null
  readAt: string | null
  createdAt: string
}

export type GmailShellData = {
  connection: GmailConnectionView | null
  reviewCount: number
  notifications: NotificationItem[]
}
