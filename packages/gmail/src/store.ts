import type { SupabaseClient } from "@supabase/supabase-js"
import type { ClassifierClass, EmailClass } from "@vagapilot/core/email"
import type { LinkableApplication } from "@vagapilot/core/email-linking"
import type { ReviewReason } from "@vagapilot/core/email-outcome"
import {
  APPLICATION_STATUSES,
  type ApplicationStatus,
} from "@vagapilot/core/status"
import { fromBytea, toBytea } from "@vagapilot/db/server"
import { z } from "zod"

/**
 * Server-side persistence of the Gmail sync, with the service_role client. There is no
 * auth.uid() in background jobs, so EVERY query here filters by an explicit user id and status
 * writes go through the service-role-only `gmail_*` SQL functions, which re-check ownership.
 */

export type GmailConnection = {
  userId: string
  googleEmail: string
  scopes: string[]
  status: string
  lastHistoryId: string | null
  lastSyncedAt: string | null
}

const connectionSchema = z.object({
  user_id: z.string(),
  google_email: z.string(),
  scopes: z.array(z.string()),
  status: z.string().nullable(),
  last_history_id: z.string().nullable(),
  last_synced_at: z.string().nullable(),
})

const applicationSchema = z.object({
  id: z.string(),
  company: z.string(),
  role_title: z.string(),
  status: z.enum(APPLICATION_STATUSES),
  link: z.string().nullable(),
  applied_at: z.string().nullable(),
  created_at: z.string(),
  external_protocol: z.string().nullable(),
})

export type ThreadSuggestion = {
  status: ApplicationStatus | null
  reason: ReviewReason
  candidates?: string[]
}

export type ThreadExtracted = {
  company: string | null
  role: string | null
  deadline: string | null
  interview_at: string | null
  link: string | null
  links?: string[]
  suggestion?: ThreadSuggestion
  model: string
  prompt_version: string
}

export type ThreadInsert = {
  gmailThreadId: string
  gmailMessageId: string
  fromAddress: string | null
  fromDomain: string | null
  subject: string
  receivedAt: Date
  snippet: string
  classification: EmailClass
  confidence: number
  extracted: ThreadExtracted
  applicationId: string | null
  reviewStatus: "auto" | "revisar"
}

export type NotificationInsert = {
  kind: "status_changed" | "review_needed" | "deadline_reminder" | "gmail_error"
  params: Record<string, unknown>
  applicationId?: string | null
  emailThreadId?: string | null
  dedupeKey?: string | null
}

export class GmailStoreError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = "GmailStoreError"
  }
}

function fail(code: string, error: { message: string } | null): never {
  throw new GmailStoreError(code, error?.message ?? code)
}

/** Classes stored in `email_threads.classification` (the PDF enum has no OTP class). */
export function persistableClass(value: ClassifierClass): EmailClass | null {
  return value === "codigo_verificacao" ? null : value
}

export class GmailStore {
  constructor(readonly admin: SupabaseClient) {}

  async getConnection(userId: string): Promise<GmailConnection | null> {
    const { data, error } = await this.admin
      .from("gmail_connections")
      .select(
        "user_id, google_email, scopes, status, last_history_id, last_synced_at"
      )
      .eq("user_id", userId)
      .maybeSingle()
    if (error) fail("connection_read", error)
    if (!data) return null
    const row = connectionSchema.parse(data)
    return {
      userId: row.user_id,
      googleEmail: row.google_email,
      scopes: row.scopes,
      status: row.status ?? "ativo",
      lastHistoryId: row.last_history_id,
      lastSyncedAt: row.last_synced_at,
    }
  }

  /** CA11.3: a revoked or deleted connection stops the sync at the next message. */
  async isActive(userId: string): Promise<boolean> {
    const { data } = await this.admin
      .from("gmail_connections")
      .select("status")
      .eq("user_id", userId)
      .maybeSingle<{ status: string | null }>()
    return Boolean(data) && (data?.status ?? "ativo") === "ativo"
  }

  async listActiveUserIds(): Promise<string[]> {
    const { data, error } = await this.admin
      .from("gmail_connections")
      .select("user_id")
      .eq("status", "ativo")
    if (error) fail("connections_list", error)
    return (data ?? []).map((row: { user_id: string }) => row.user_id)
  }

  async readRefreshToken(userId: string): Promise<Uint8Array | null> {
    const { data, error } = await this.admin
      .from("gmail_connections")
      .select("refresh_token_enc")
      .eq("user_id", userId)
      .maybeSingle<{ refresh_token_enc: string | null }>()
    if (error) fail("token_read", error)
    return fromBytea(data?.refresh_token_enc ?? null)
  }

  /** Creates or replaces the connection after OAuth (P4.1). Scopes are merged (incremental). */
  async upsertConnection(input: {
    userId: string
    googleEmail: string
    scopes: string[]
    refreshTokenEnc: Uint8Array
  }): Promise<void> {
    const { error } = await this.admin.from("gmail_connections").upsert(
      {
        user_id: input.userId,
        google_email: input.googleEmail,
        scopes: input.scopes,
        refresh_token_enc: toBytea(input.refreshTokenEnc),
        status: "ativo",
        last_error: null,
        connected_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    )
    if (error) fail("connection_write", error)
  }

  /** RF11.9 / CA11.3: deletes the row with the token. Returns whether a row existed. */
  async deleteConnection(userId: string): Promise<boolean> {
    const { data, error } = await this.admin
      .from("gmail_connections")
      .delete()
      .eq("user_id", userId)
      .select("user_id")
    if (error) fail("connection_delete", error)
    return (data ?? []).length > 0
  }

  async markError(userId: string, code: string): Promise<void> {
    await this.admin
      .from("gmail_connections")
      .update({ status: "erro", last_error: code, sync_lock_until: null })
      .eq("user_id", userId)
  }

  /** One sync per user at a time. Returns false when another run holds the lock. */
  async claimSyncLock(
    userId: string,
    ttlMs: number,
    now: Date
  ): Promise<boolean> {
    const until = new Date(now.getTime() + ttlMs).toISOString()
    const { data, error } = await this.admin
      .from("gmail_connections")
      .update({ sync_lock_until: until })
      .eq("user_id", userId)
      .eq("status", "ativo")
      .or(`sync_lock_until.is.null,sync_lock_until.lt.${now.toISOString()}`)
      .select("user_id")
    if (error) fail("lock", error)
    return (data ?? []).length > 0
  }

  async finishSync(
    userId: string,
    result: { historyId: string | null; syncedAt: Date }
  ): Promise<void> {
    const patch: Record<string, unknown> = {
      sync_lock_until: null,
      last_synced_at: result.syncedAt.toISOString(),
      last_error: null,
    }
    if (result.historyId) patch.last_history_id = result.historyId
    await this.admin
      .from("gmail_connections")
      .update(patch)
      .eq("user_id", userId)
  }

  async releaseLock(userId: string): Promise<void> {
    await this.admin
      .from("gmail_connections")
      .update({ sync_lock_until: null })
      .eq("user_id", userId)
  }

  async listApplications(userId: string): Promise<LinkableApplication[]> {
    const { data, error } = await this.admin
      .from("applications")
      .select(
        "id, company, role_title, status, link, applied_at, created_at, external_protocol"
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1000)
    if (error) fail("applications_read", error)
    return (data ?? []).flatMap((row: unknown) => {
      const parsed = applicationSchema.safeParse(row)
      if (!parsed.success) return []
      const app = parsed.data
      return [
        {
          id: app.id,
          company: app.company,
          roleTitle: app.role_title,
          status: app.status,
          link: app.link,
          appliedAt: app.applied_at,
          createdAt: app.created_at,
          externalProtocol: app.external_protocol,
        },
      ]
    })
  }

  async knownMessageIds(
    userId: string,
    ids: readonly string[]
  ): Promise<Set<string>> {
    if (ids.length === 0) return new Set()
    const { data, error } = await this.admin
      .from("email_threads")
      .select("gmail_message_id")
      .eq("user_id", userId)
      .in("gmail_message_id", [...ids])
    if (error) fail("threads_read", error)
    return new Set(
      (data ?? []).map(
        (row: { gmail_message_id: string }) => row.gmail_message_id
      )
    )
  }

  /** Metadata + snippet only (CA11.4). Returns null when the message was already stored. */
  async insertThread(
    userId: string,
    thread: ThreadInsert
  ): Promise<string | null> {
    const { data, error } = await this.admin
      .from("email_threads")
      .upsert(
        {
          user_id: userId,
          gmail_thread_id: thread.gmailThreadId,
          gmail_message_id: thread.gmailMessageId,
          from_address: thread.fromAddress,
          from_domain: thread.fromDomain,
          subject: thread.subject.slice(0, 300),
          received_at: thread.receivedAt.toISOString(),
          snippet: thread.snippet,
          classification: thread.classification,
          confidence: thread.confidence,
          extracted: thread.extracted,
          application_id: thread.applicationId,
          review_status: thread.reviewStatus,
        },
        { onConflict: "user_id,gmail_message_id", ignoreDuplicates: true }
      )
      .select("id")
    if (error) fail("thread_write", error)
    return (data as { id: string }[] | null)?.[0]?.id ?? null
  }

  async updateThread(
    userId: string,
    threadId: string,
    patch: {
      applicationId?: string | null
      reviewStatus?: "auto" | "revisar"
      extracted?: ThreadExtracted
    }
  ): Promise<void> {
    const update: Record<string, unknown> = {}
    if (patch.applicationId !== undefined)
      update.application_id = patch.applicationId
    if (patch.reviewStatus) update.review_status = patch.reviewStatus
    if (patch.extracted) update.extracted = patch.extracted
    const { error } = await this.admin
      .from("email_threads")
      .update(update)
      .eq("id", threadId)
      .eq("user_id", userId)
    if (error) fail("thread_update", error)
  }

  async insertEvidence(
    userId: string,
    applicationId: string,
    textExcerpt: string
  ): Promise<string> {
    const { data, error } = await this.admin
      .from("evidences")
      .insert({
        user_id: userId,
        application_id: applicationId,
        kind: "email",
        text_excerpt: textExcerpt,
      })
      .select("id")
      .single<{ id: string }>()
    if (error || !data) fail("evidence_write", error)
    return data.id
  }

  /** Atomic status change through the service-role function (ownership re-checked in SQL). */
  async changeStatus(
    userId: string,
    input: {
      applicationId: string
      from: ApplicationStatus
      to: ApplicationStatus
      confidence: number
      threadId: string
      evidenceId: string
    }
  ): Promise<"ok" | "status_conflict"> {
    const { error } = await this.admin.rpc("gmail_change_application_status", {
      p_user_id: userId,
      p_application_id: input.applicationId,
      p_from: input.from,
      p_to: input.to,
      p_confidence: input.confidence,
      p_email_thread_id: input.threadId,
      p_evidence_id: input.evidenceId,
    })
    if (!error) return "ok"
    if (error.message.includes("status_conflict")) return "status_conflict"
    fail("status_change", error)
  }

  async setNextAction(
    userId: string,
    input: {
      applicationId: string
      action: string
      dueAt: Date
      threadId: string
    }
  ): Promise<void> {
    const { error } = await this.admin.rpc(
      "gmail_set_application_next_action",
      {
        p_user_id: userId,
        p_application_id: input.applicationId,
        p_next_action: input.action,
        p_due_at: input.dueAt.toISOString(),
        p_email_thread_id: input.threadId,
      }
    )
    if (error) fail("next_action", error)
  }

  /** Timeline entry for an e-mail linked without a status change. */
  async linkEmailEvent(
    userId: string,
    input: { applicationId: string; threadId: string; confidence: number }
  ): Promise<void> {
    const { error } = await this.admin.from("application_events").insert({
      user_id: userId,
      application_id: input.applicationId,
      type: "email_linked",
      source: "gmail",
      confidence: input.confidence,
      email_thread_id: input.threadId,
    })
    if (error) fail("event_write", error)
    await this.admin
      .from("applications")
      .update({ last_email_at: new Date().toISOString() })
      .eq("id", input.applicationId)
      .eq("user_id", userId)
  }

  /** RF11.7: application made outside the app, created as `enviada`, source email. */
  async createApplicationFromEmail(
    userId: string,
    input: {
      company: string
      roleTitle: string
      appliedAt: Date
      link: string | null
      confidence: number
      threadId: string
      evidenceText: string
    }
  ): Promise<string> {
    const { data, error } = await this.admin
      .from("applications")
      .insert({
        user_id: userId,
        company: input.company.slice(0, 200),
        role_title: input.roleTitle.slice(0, 200),
        source: "email",
        status: "enviada",
        applied_at: input.appliedAt.toISOString(),
        link: input.link,
        last_email_at: new Date().toISOString(),
        notes: null,
      })
      .select("id")
      .single<{ id: string }>()
    if (error || !data) fail("application_write", error)
    const evidenceId = await this.insertEvidence(
      userId,
      data.id,
      input.evidenceText
    )
    const { error: eventError } = await this.admin
      .from("application_events")
      .insert({
        user_id: userId,
        application_id: data.id,
        type: "status_change",
        from_status: null,
        to_status: "enviada",
        source: "gmail",
        confidence: input.confidence,
        payload: { created: true, from_email: true },
        email_thread_id: input.threadId,
        evidence_id: evidenceId,
      })
    if (eventError) fail("event_write", eventError)
    return data.id
  }

  async notify(
    userId: string,
    notification: NotificationInsert
  ): Promise<void> {
    const { error } = await this.admin.from("notifications").upsert(
      {
        user_id: userId,
        kind: notification.kind,
        params: notification.params,
        application_id: notification.applicationId ?? null,
        email_thread_id: notification.emailThreadId ?? null,
        dedupe_key: notification.dedupeKey ?? null,
      },
      { onConflict: "user_id,dedupe_key", ignoreDuplicates: true }
    )
    if (error) fail("notification_write", error)
  }
}
