import "server-only"

import { createEmbedder } from "@vagapilot/ai"
import { normalizeCompanyName } from "@vagapilot/core/blocklist"
import {
  FACT_KINDS,
  factCanonicalKey,
  factsSimilar,
  type FactKind,
  type FactStatus,
} from "@vagapilot/core/facts"
import { z } from "zod"

import { audit } from "@/lib/server/audit"
import type { UserContext } from "@/lib/server/context"

export type ExperienceHint = {
  company: string
  title?: string
  start_month?: string | null
  end_month?: string | null
  is_current?: boolean
}

type SourceRef = {
  cv_version_id?: string
  excerpt?: string
  experience_hint?: ExperienceHint | null
  edited?: boolean
  original_statement?: string
} & Record<string, unknown>

type FactRow = {
  id: string
  experience_id: string | null
  statement: string
  kind: string
  tags: string[] | null
  status: FactStatus
  source: string
  source_ref: SourceRef | null
  created_at: string
}

export type FactView = {
  id: string
  statement: string
  kind: FactKind
  tags: string[]
  status: FactStatus
  source: string
  excerpt: string | null
  edited: boolean
}

export type FactGroup = {
  key: string
  /** Linked profile experience, when the facts already point to one. */
  experienceId: string | null
  /** Experience detected in the CV but not yet in the profile. */
  hint: ExperienceHint | null
  title: string | null
  subtitle: string | null
  facts: FactView[]
}

export type FactReview = {
  groups: FactGroup[]
  counts: Record<FactStatus, number>
}

export const factIdsSchema = z.array(z.uuid()).min(1).max(200)
export const editFactSchema = z.object({
  id: z.uuid(),
  statement: z.string().trim().min(2, "required").max(500, "tooLong"),
  kind: z.enum(FACT_KINDS),
})
export type EditFactInput = z.infer<typeof editFactSchema>

function toView(row: FactRow): FactView {
  return {
    id: row.id,
    statement: row.statement,
    kind: (FACT_KINDS as readonly string[]).includes(row.kind)
      ? (row.kind as FactKind)
      : "competencia",
    tags: row.tags ?? [],
    status: row.status,
    source: row.source,
    excerpt: row.source_ref?.excerpt ?? null,
    edited: row.source_ref?.edited === true,
  }
}

/** Facts grouped by experience for "Confirme seus fatos" (P1.3). */
type FactKeyRow = {
  id: string
  status: FactStatus
  statement: string
}

/**
 * One definition for "facts to review" everywhere (QA 02:42: /app/cvs said 16, /app/fatos 25).
 * A fact is shown once per canonical statement (see factCanonicalKey); a proposal that repeats
 * a confirmed or rejected fact is hidden, as is a later copy of the same proposal.
 */
export function visibleFactIds(rows: FactKeyRow[]): {
  ids: Set<string>
  counts: Record<FactStatus, number>
} {
  const rank: Record<FactStatus, number> = {
    confirmado: 0,
    rejeitado: 1,
    proposto: 2,
  }
  const sorted = rows
    .map((row, index) => ({ row, index }))
    .sort(
      (a, b) => rank[a.row.status] - rank[b.row.status] || a.index - b.index
    )
  const ids = new Set<string>()
  const counts: Record<FactStatus, number> = {
    proposto: 0,
    confirmado: 0,
    rejeitado: 0,
  }
  const kept: { key: string; statement: string }[] = []
  for (const { row } of sorted) {
    const key = factCanonicalKey(row.statement)
    // Confirmed/rejected history is kept as is; only proposals that repeat (or nearly repeat,
    // see factsSimilar) an earlier fact are collapsed.
    if (
      row.status === "proposto" &&
      kept.some(
        (other) =>
          other.key === key || factsSimilar(other.statement, row.statement)
      )
    )
      continue
    kept.push({ key, statement: row.statement })
    ids.add(row.id)
    counts[row.status] += 1
  }
  return { ids, counts }
}

/** Fact counts per status with the same rules as the review page. */
export async function loadFactCounts(
  ctx: UserContext
): Promise<Record<FactStatus, number>> {
  const { data, error } = await ctx.supabase
    .from("confirmed_facts")
    .select("id, status, statement, created_at")
    .eq("user_id", ctx.user.id)
    .order("created_at")
  if (error) throw new Error(error.message)
  return visibleFactIds((data ?? []) as FactKeyRow[]).counts
}

export async function loadFactReview(
  ctx: UserContext,
  status: FactStatus
): Promise<FactReview> {
  const [facts, experiences, counts] = await Promise.all([
    ctx.supabase
      .from("confirmed_facts")
      .select(
        "id, experience_id, statement, kind, tags, status, source, source_ref, created_at"
      )
      .eq("user_id", ctx.user.id)
      .eq("status", status)
      .order("created_at"),
    ctx.supabase
      .from("experiences")
      .select("id, company, title, start_date, end_date, is_current")
      .eq("user_id", ctx.user.id),
    ctx.supabase
      .from("confirmed_facts")
      .select("id, status, statement, created_at")
      .eq("user_id", ctx.user.id)
      .order("created_at"),
  ])
  for (const result of [facts, experiences, counts]) {
    if (result.error) throw new Error(result.error.message)
  }

  const experienceById = new Map(
    (
      (experiences.data ?? []) as {
        id: string
        company: string
        title: string
        start_date: string
        end_date: string | null
        is_current: boolean | null
      }[]
    ).map((row) => [row.id, row])
  )

  const visible = visibleFactIds((counts.data ?? []) as FactKeyRow[])
  const groups = new Map<string, FactGroup>()
  for (const row of (facts.data ?? []) as FactRow[]) {
    if (!visible.ids.has(row.id)) continue
    const experience = row.experience_id
      ? experienceById.get(row.experience_id)
      : undefined
    const hint = row.source_ref?.experience_hint ?? null
    let group: FactGroup
    if (experience) {
      const key = `exp:${experience.id}`
      group = groups.get(key) ?? {
        key,
        experienceId: experience.id,
        hint: null,
        title: experience.title,
        subtitle: experience.company,
        facts: [],
      }
      groups.set(key, group)
    } else if (hint?.company) {
      const key = `hint:${normalizeCompanyName(hint.company)}`
      group = groups.get(key) ?? {
        key,
        experienceId: null,
        hint,
        title: hint.title ?? null,
        subtitle: hint.company,
        facts: [],
      }
      groups.set(key, group)
    } else {
      group = groups.get("other") ?? {
        key: "other",
        experienceId: null,
        hint: null,
        title: null,
        subtitle: null,
        facts: [],
      }
      groups.set("other", group)
    }
    group.facts.push(toView(row))
  }

  const ordered = [...groups.values()].sort((a, b) => {
    if (a.key === "other") return 1
    if (b.key === "other") return -1
    return 0
  })
  return { groups: ordered, counts: visible.counts }
}

async function experienceIndex(ctx: UserContext): Promise<Map<string, string>> {
  const { data, error } = await ctx.supabase
    .from("experiences")
    .select("id, company")
    .eq("user_id", ctx.user.id)
  if (error) throw new Error(error.message)
  return new Map(
    ((data ?? []) as { id: string; company: string }[]).map((row) => [
      normalizeCompanyName(row.company),
      row.id,
    ])
  )
}

/** Confirms facts owned by the user; links them to a matching profile experience. */
export async function confirmFacts(
  ctx: UserContext,
  ids: string[]
): Promise<number> {
  const { data, error } = await ctx.supabase
    .from("confirmed_facts")
    .select("id, experience_id, kind, source, source_ref, status")
    .eq("user_id", ctx.user.id)
    .in("id", ids)
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as Pick<
    FactRow,
    "id" | "experience_id" | "kind" | "source" | "source_ref" | "status"
  >[]
  const byCompany = await experienceIndex(ctx)
  const now = new Date().toISOString()
  let confirmed = 0
  for (const row of rows) {
    if (row.status === "confirmado") continue
    const hint = row.source_ref?.experience_hint?.company
    const experienceId =
      row.experience_id ??
      (hint ? (byCompany.get(normalizeCompanyName(hint)) ?? null) : null)
    const update = await ctx.supabase
      .from("confirmed_facts")
      .update({
        status: "confirmado",
        confirmed_at: now,
        experience_id: experienceId,
      })
      .eq("id", row.id)
      .eq("user_id", ctx.user.id)
    if (update.error) throw new Error(update.error.message)
    await audit({
      userId: ctx.user.id,
      actor: "usuario",
      action: "fact.confirmed",
      targetType: "confirmed_fact",
      targetId: row.id,
      details: {
        source: row.source,
        kind: row.kind,
        edited: false,
        from: row.status,
      },
    })
    confirmed += 1
  }
  return confirmed
}

export async function rejectFacts(
  ctx: UserContext,
  ids: string[]
): Promise<number> {
  const { data, error } = await ctx.supabase
    .from("confirmed_facts")
    .update({ status: "rejeitado", confirmed_at: null })
    .eq("user_id", ctx.user.id)
    .in("id", ids)
    .neq("status", "rejeitado")
    .select("id, kind, source")
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as { id: string; kind: string; source: string }[]
  for (const row of rows) {
    await audit({
      userId: ctx.user.id,
      actor: "usuario",
      action: "fact.rejected",
      targetType: "confirmed_fact",
      targetId: row.id,
      details: { source: row.source, kind: row.kind },
    })
  }
  return rows.length
}

/** "Editar e confirmar": new text, new embedding, original kept in source_ref. */
export async function editAndConfirmFact(
  ctx: UserContext,
  input: EditFactInput
): Promise<boolean> {
  const current = await ctx.supabase
    .from("confirmed_facts")
    .select("id, statement, source, source_ref, experience_id")
    .eq("id", input.id)
    .eq("user_id", ctx.user.id)
    .maybeSingle<
      Pick<
        FactRow,
        "id" | "statement" | "source" | "source_ref" | "experience_id"
      >
    >()
  if (current.error) throw new Error(current.error.message)
  if (!current.data) return false

  const sourceRef: SourceRef = {
    ...(current.data.source_ref ?? {}),
    edited: true,
    original_statement:
      current.data.source_ref?.original_statement ?? current.data.statement,
  }
  const hint = sourceRef.experience_hint?.company
  const experienceId =
    current.data.experience_id ??
    (hint
      ? ((await experienceIndex(ctx)).get(normalizeCompanyName(hint)) ?? null)
      : null)
  const embedding = await createEmbedder().embed(input.statement)
  const update = await ctx.supabase
    .from("confirmed_facts")
    .update({
      statement: input.statement,
      kind: input.kind,
      status: "confirmado",
      confirmed_at: new Date().toISOString(),
      source_ref: sourceRef,
      experience_id: experienceId,
      embedding: JSON.stringify(embedding),
    })
    .eq("id", input.id)
    .eq("user_id", ctx.user.id)
  if (update.error) throw new Error(update.error.message)
  await audit({
    userId: ctx.user.id,
    actor: "usuario",
    action: "fact.confirmed",
    targetType: "confirmed_fact",
    targetId: input.id,
    details: { source: current.data.source, kind: input.kind, edited: true },
  })
  return true
}

/** Links facts to a profile experience after verifying both belong to the user. */
export async function linkFactsToExperience(
  ctx: UserContext,
  experienceId: string,
  ids: string[]
): Promise<number> {
  const experience = await ctx.supabase
    .from("experiences")
    .select("id")
    .eq("id", experienceId)
    .eq("user_id", ctx.user.id)
    .maybeSingle()
  if (experience.error) throw new Error(experience.error.message)
  if (!experience.data) return 0
  const { data, error } = await ctx.supabase
    .from("confirmed_facts")
    .update({ experience_id: experienceId })
    .eq("user_id", ctx.user.id)
    .in("id", ids)
    .select("id")
  if (error) throw new Error(error.message)
  return (data ?? []).length
}
