import type { SupabaseClient } from "@supabase/supabase-js"
import { z } from "zod"

import { APPLICATION_STATUSES, EVENT_SOURCES } from "@vagapilot/core/status"
import {
  APPLICATION_ROUTES,
  CONTRACT_REGIMES,
  FIT_LEVELS,
  JOB_SOURCES,
  type TrackerApplication,
} from "@vagapilot/core/tracker"

import {
  TIMELINE_EVENT_TYPES,
  type ApplicationDetail,
  type CvOption,
  type EvidenceItem,
  type TimelineEvent,
} from "./types"

/** Server-only reads. Every query runs with the user's session, so RLS scopes the rows. */

const one = <T extends z.ZodType>(schema: T) =>
  z
    .union([schema, z.array(schema)])
    .nullable()
    .transform((value) => (Array.isArray(value) ? (value[0] ?? null) : value))

const salarySchema = z
  .object({
    text: z.string().optional(),
    amount: z.number().optional(),
    currency: z.string().optional(),
  })
  .passthrough()
  .nullable()

const applicationRowSchema = z.object({
  id: z.string(),
  company: z.string(),
  role_title: z.string(),
  source: z.enum(JOB_SOURCES),
  route: z.enum(APPLICATION_ROUTES).nullable(),
  status: z.enum(APPLICATION_STATUSES),
  applied_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  next_action: z.string().nullable(),
  next_action_due_at: z.string().nullable(),
  link: z.string().nullable(),
  notes: z.string().nullable(),
  salary_informed: salarySchema,
  match: one(
    z.object({
      fit: z.enum(FIT_LEVELS).nullable(),
      fit_score: z.number().nullable(),
    })
  ),
  posting: one(
    z.object({
      location: z.string().nullable(),
      regime: z.enum(CONTRACT_REGIMES).nullable(),
    })
  ),
  cv: one(
    z.object({
      label: z.string().nullable(),
      track: one(z.object({ name: z.string() })),
    })
  ),
})

export const APPLICATION_SELECT = `
  id, company, role_title, source, route, status, applied_at, created_at, updated_at,
  next_action, next_action_due_at, link, notes, salary_informed,
  match:job_matches!applications_job_match_id_fkey ( fit, fit_score ),
  posting:job_postings!applications_job_posting_id_fkey ( location, regime ),
  cv:cv_versions!applications_cv_version_id_fkey ( label, track:cv_tracks ( name ) )
`

function iso(value: string): string {
  return new Date(value).toISOString()
}

function isoOrNull(value: string | null): string | null {
  return value ? iso(value) : null
}

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
})

function salaryText(value: z.infer<typeof salarySchema>): string | null {
  if (!value) return null
  if (value.text?.trim()) return value.text.trim()
  if (typeof value.amount === "number") {
    return value.currency && value.currency !== "BRL"
      ? new Intl.NumberFormat("pt-BR", {
          style: "currency",
          currency: value.currency,
        }).format(value.amount)
      : brl.format(value.amount)
  }
  return null
}

export function toTrackerApplication(raw: unknown): TrackerApplication | null {
  const parsed = applicationRowSchema.safeParse(raw)
  if (!parsed.success) return null
  const row = parsed.data
  return {
    id: row.id,
    company: row.company,
    roleTitle: row.role_title,
    source: row.source,
    route: row.route,
    status: row.status,
    appliedAt: isoOrNull(row.applied_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    nextAction: row.next_action,
    nextActionDueAt: isoOrNull(row.next_action_due_at),
    link: row.link,
    notes: row.notes,
    location: row.posting?.location ?? null,
    regime: row.posting?.regime ?? null,
    fit: row.match?.fit ?? null,
    fitScore: row.match?.fit_score ?? null,
    cvLabel: row.cv?.label ?? null,
    cvTrack: row.cv?.track?.name ?? null,
    salaryInformed: salaryText(row.salary_informed),
  }
}

export async function listApplications(
  supabase: SupabaseClient
): Promise<TrackerApplication[] | null> {
  const { data, error } = await supabase
    .from("applications")
    .select(APPLICATION_SELECT)
    .order("created_at", { ascending: false })
  if (error || !Array.isArray(data)) return null
  return data.flatMap((row: unknown) => {
    const application = toTrackerApplication(row)
    return application ? [application] : []
  })
}

const cvRowSchema = z.object({
  id: z.string(),
  label: z.string().nullable(),
  language: z.string().nullable(),
  track: one(z.object({ name: z.string() })),
})

export async function listCvOptions(
  supabase: SupabaseClient
): Promise<CvOption[]> {
  const { data, error } = await supabase
    .from("cv_versions")
    .select("id, label, language, track:cv_tracks ( name )")
    .order("is_default", { ascending: false })
  if (error || !Array.isArray(data)) return []
  return data.flatMap((row: unknown) => {
    const parsed = cvRowSchema.safeParse(row)
    if (!parsed.success) return []
    const { id, label, language, track } = parsed.data
    return [
      {
        id,
        label: [label ?? track?.name ?? id.slice(0, 8), language]
          .filter(Boolean)
          .join(" · "),
        track: track?.name ?? null,
      },
    ]
  })
}

const eventRowSchema = z.object({
  id: z.string(),
  type: z.string(),
  from_status: z.enum(APPLICATION_STATUSES).nullable(),
  to_status: z.enum(APPLICATION_STATUSES).nullable(),
  source: z.enum(EVENT_SOURCES),
  confidence: z.coerce.number().nullable(),
  payload: z.record(z.string(), z.unknown()).nullable(),
  occurred_at: z.string(),
  evidence_id: z.string().nullable(),
  thread: one(z.object({ subject: z.string().nullable() })),
})

const evidenceRowSchema = z.object({
  id: z.string(),
  kind: z.string(),
  storage_path: z.string().nullable(),
  text_excerpt: z.string().nullable(),
  url: z.string().nullable(),
  created_at: z.string(),
})

const IMAGE_PATH = /\.(png|jpe?g|webp|gif)$/i
const SIGNED_URL_SECONDS = 5 * 60

function payloadText(
  payload: Record<string, unknown> | null,
  key: string
): string | null {
  const value = payload?.[key]
  return typeof value === "string" ? value : null
}

function isTimelineType(value: string): value is TimelineEvent["type"] {
  return (TIMELINE_EVENT_TYPES as readonly string[]).includes(value)
}

/** Timeline and evidences of one application (RF10.4). Null when the row is not the user's. */
export async function getApplicationDetail(
  supabase: SupabaseClient,
  applicationId: string
): Promise<ApplicationDetail | null> {
  const owned = await supabase
    .from("applications")
    .select("id")
    .eq("id", applicationId)
    .maybeSingle()
  if (owned.error || !owned.data) return null

  const [events, evidences] = await Promise.all([
    supabase
      .from("application_events")
      .select(
        "id, type, from_status, to_status, source, confidence, payload, occurred_at, evidence_id, thread:email_threads!application_events_email_thread_id_fkey ( subject )"
      )
      .eq("application_id", applicationId)
      .order("occurred_at", { ascending: false }),
    supabase
      .from("evidences")
      .select("id, kind, storage_path, text_excerpt, url, created_at")
      .eq("application_id", applicationId)
      .order("created_at", { ascending: false }),
  ])

  const timeline: TimelineEvent[] = (
    Array.isArray(events.data) ? events.data : []
  ).flatMap((row: unknown) => {
    const parsed = eventRowSchema.safeParse(row)
    if (!parsed.success) return []
    const event = parsed.data
    const type = event.type
    if (!isTimelineType(type)) return []
    const payload = event.payload
    return [
      {
        id: event.id,
        type,
        fromStatus: event.from_status,
        toStatus: event.to_status,
        source: event.source,
        confidence: event.confidence,
        occurredAt: iso(event.occurred_at),
        action: payloadText(payload, "action"),
        dueAt: isoOrNull(payloadText(payload, "due_at")),
        done: payload?.done === true,
        created: payload?.created === true,
        imported: payload?.imported === true,
        emailSubject: event.thread?.subject ?? null,
        hasEvidence: event.evidence_id !== null,
      },
    ]
  })

  const evidenceRows = (
    Array.isArray(evidences.data) ? evidences.data : []
  ).flatMap((row: unknown) => {
    const parsed = evidenceRowSchema.safeParse(row)
    return parsed.success ? [parsed.data] : []
  })
  const imagePaths = evidenceRows
    .map((row) => row.storage_path)
    .filter((path): path is string => Boolean(path && IMAGE_PATH.test(path)))
  const signed = new Map<string, string>()
  if (imagePaths.length > 0) {
    const { data } = await supabase.storage
      .from("evidences")
      .createSignedUrls(imagePaths, SIGNED_URL_SECONDS)
    for (const item of data ?? []) {
      if (item.path && item.signedUrl && !item.error)
        signed.set(item.path, item.signedUrl)
    }
  }

  const items: EvidenceItem[] = evidenceRows.map((row) => ({
    id: row.id,
    kind: row.kind,
    textExcerpt: row.text_excerpt,
    url: row.url,
    imageUrl: row.storage_path ? (signed.get(row.storage_path) ?? null) : null,
    createdAt: iso(row.created_at),
  }))

  return { events: timeline, evidences: items }
}
