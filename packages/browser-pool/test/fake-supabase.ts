import { randomUUID } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

type Row = Record<string, unknown>

/** Tiny in-memory PostgREST stand-in: eq/in filters, insert/update/upsert/delete, single. */
export function fakeSupabase(tables: Record<string, Row[]> = {}) {
  const db: Record<string, Row[]> = tables
  const from = (table: string) => {
    db[table] ??= []
    let op: "select" | "insert" | "update" | "upsert" | "delete" = "select"
    let payload: Row | Row[] | null = null
    let conflict: string[] = []
    const filters: ((r: Row) => boolean)[] = []
    let mode: "many" | "single" | "maybe" = "many"
    const builder = {
      select: () => builder,
      insert: (v: Row | Row[]) => ((op = "insert"), (payload = v), builder),
      update: (v: Row) => ((op = "update"), (payload = v), builder),
      upsert: (v: Row, o?: { onConflict?: string }) => (
        (op = "upsert"),
        (payload = v),
        (conflict = (o?.onConflict ?? "id").split(",")),
        builder
      ),
      delete: () => ((op = "delete"), builder),
      eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), builder),
      in: (k: string, v: unknown[]) => (
        filters.push((r) => v.includes(r[k])),
        builder
      ),
      gte: () => builder,
      or: () => builder,
      order: () => builder,
      limit: () => builder,
      single: () => ((mode = "single"), builder),
      maybeSingle: () => ((mode = "maybe"), builder),
      then(resolve: (v: { data: unknown; error: null }) => void) {
        const rows = db[table]!
        let out: Row[] = []
        if (op === "select")
          out = rows.filter((r) => filters.every((f) => f(r)))
        if (op === "insert") {
          const list = (Array.isArray(payload) ? payload : [payload!]).map(
            (r) => ({ id: randomUUID(), ...r })
          )
          rows.push(...list)
          out = list
        }
        if (op === "update") {
          out = rows.filter((r) => filters.every((f) => f(r)))
          for (const r of out) Object.assign(r, payload)
        }
        if (op === "upsert") {
          const row = payload as Row
          const existing = rows.find((r) =>
            conflict.every((k) => r[k] === row[k])
          )
          if (existing) Object.assign(existing, row)
          else rows.push({ ...row })
          out = [existing ?? row]
        }
        if (op === "delete") {
          out = rows.filter((r) => filters.every((f) => f(r)))
          db[table] = rows.filter((r) => !out.includes(r))
        }
        const data = mode === "many" ? out : (out[0] ?? null)
        resolve({ data, error: null })
      },
    }
    return builder
  }
  return { client: { from } as unknown as SupabaseClient, db }
}
