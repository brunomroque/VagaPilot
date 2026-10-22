import type { SupabaseClient } from "@supabase/supabase-js"
import { z } from "zod"

import { EMAIL_CLASSES } from "@vagapilot/core/email"
import { REVIEW_REASONS } from "@vagapilot/core/email-outcome"
import { APPLICATION_STATUSES } from "@vagapilot/core/status"

import {
  NOTIFICATION_KINDS,
  type GmailConnectionView,
  type GmailShellData,
  type NotificationItem,
  type ReviewItem,
} from "./types"

/** Reads under the user's RLS session. The token column is not even selectable (12.3). */

const READONLY = "https://www.googleapis.com/auth/gmail.readonly"
const SEND = "https://www.googleapis.com/auth/gmail.send"

const one = <T extends z.ZodType>(schema: T) =>
  z
    .union([schema, z.array(schema)])
    .nullable()
    .transform((value) => (Array.isArray(value) ? (value[0] ?? null) : value))

const connectionSchema = z.object({
  google_email: z.string(),
  scopes: z.array(z.string()),
  status: z.enum(["ativo", "erro", "revogado"]).nullable(),
  last_synced_at: z.string().nullable(),
  connected_at: z.string().nullable(),
  last_error: z.string().nullable(),
})

function iso(value: string | null): string | null {
  return value ? new Date(value).toISOString() : null
}

export async function getGmailConnection(
  supabase: SupabaseClient
): Promise<GmailConnectionView | null> {
  const { data, error } = await supabase
    .from("gmail_connections")
    .select(
      "google_email, scopes, status, last_synced_at, connected_at, last_error"
    )
    .maybeSingle()
  if (error || !data) return null
  const parsed = connectionSchema.safeParse(data)
  if (!parsed.success) return null
  const row = parsed.data
  return {
    googleEmail: row.google_email,
    canRead: row.scopes.includes(READONLY),
    canSend: row.scopes.includes(SEND),
    status: row.status ?? "ativo",
    lastSyncedAt: iso(row.last_synced_at),
    connectedAt: iso(row.connected_at),
    lastError: row.last_error,
  }
}

export async function countReviewItems(
  supabase: SupabaseClient
): Promise<number> {
  const { count } = await supabase
    .from("email_threads")
    .select("id", { count: "exact", head: true })
    .eq("review_status", "revisar")
  return count ?? 0
}

const extractedSchema = z
  .object({
    deadline: z.string().nullable().optional(),
    interview_at: z.string().nullable().optional(),
    suggestion: z
      .object({
        status: z.enum(APPLICATION_STATUSES).nullable(),
        reason: z.enum(REVIEW_REASONS),
      })
      .optional(),
  })
  .loose()
  .nullable()

const reviewRowSchema = z.object({
  id: z.string(),
  from_address: z.string().nullable(),
  subject: z.string().nullable(),
  received_at: z.string(),
  snippet: z.string().nullable(),
  classification: z.enum(EMAIL_CLASSES),
  confidence: z.coerce.number().nullable(),
  extracted: extractedSchema,
  application: one(
    z.object({
      id: z.string(),
      company: z.string(),
      role_title: z.string(),
      status: z.enum(APPLICATION_STATUSES),
    })
  ),
})

export async function listReviewItems(
  supabase: SupabaseClient
): Promise<ReviewItem[]> {
  const { data, error } = await supabase
    .from("email_threads")
    .select(
      "id, from_address, subject, received_at, snippet, classification, confidence, extracted, application:applications!email_threads_application_id_fkey ( id, company, role_title, status )"
    )
    .eq("review_status", "revisar")
    .order("received_at", { ascending: false })
    .limit(50)
  if (error || !Array.isArray(data)) return []
  return data.flatMap((raw: unknown) => {
    const parsed = reviewRowSchema.safeParse(raw)
    if (!parsed.success) return []
    const row = parsed.data
    const suggestion = row.extracted?.suggestion
    return [
      {
        id: row.id,
        fromAddress: row.from_address,
        subject: row.subject ?? "",
        receivedAt: new Date(row.received_at).toISOString(),
        snippet: row.snippet ?? "",
        classification: row.classification,
        confidence: row.confidence,
        suggestedStatus: suggestion?.status ?? null,
        reason: suggestion?.reason ?? null,
        deadline: row.extracted?.deadline ?? null,
        interviewAt: row.extracted?.interview_at ?? null,
        application: row.application
          ? {
              id: row.application.id,
              company: row.application.company,
              roleTitle: row.application.role_title,
              status: row.application.status,
            }
          : null,
        createdFromEmail: suggestion?.reason === "created_from_email",
      },
    ]
  })
}

const notificationSchema = z.object({
  id: z.string(),
  kind: z.enum(NOTIFICATION_KINDS),
  params: z
    .record(z.string(), z.union([z.string(), z.number(), z.null()]))
    .catch({}),
  application_id: z.string().nullable(),
  read_at: z.string().nullable(),
  created_at: z.string(),
})

export async function listNotifications(
  supabase: SupabaseClient
): Promise<NotificationItem[]> {
  const { data, error } = await supabase
    .from("notifications")
    .select("id, kind, params, application_id, read_at, created_at")
    .order("created_at", { ascending: false })
    .limit(10)
  if (error || !Array.isArray(data)) return []
  return data.flatMap((raw: unknown) => {
    const parsed = notificationSchema.safeParse(raw)
    if (!parsed.success) return []
    const row = parsed.data
    return [
      {
        id: row.id,
        kind: row.kind,
        params: row.params,
        applicationId: row.application_id,
        readAt: row.read_at ? new Date(row.read_at).toISOString() : null,
        createdAt: new Date(row.created_at).toISOString(),
      },
    ]
  })
}

export async function loadGmailShellData(
  supabase: SupabaseClient
): Promise<GmailShellData> {
  const [connection, reviewCount, notifications] = await Promise.all([
    getGmailConnection(supabase),
    countReviewItems(supabase),
    listNotifications(supabase),
  ])
  return { connection, reviewCount, notifications }
}
