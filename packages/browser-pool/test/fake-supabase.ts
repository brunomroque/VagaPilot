import { randomUUID } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

type Row = Record<string, unknown>

type QueryResult = { data: unknown; error: null }

/** Tiny in-memory PostgREST stand-in: eq/in filters, insert/update/upsert/delete, single. */
export function fakeSupabase(tables: Record<string, Row[]> = {}) {
  const db: Record<string, Row[]> = tables

  class FakeQuery implements PromiseLike<QueryResult> {
    private op: "select" | "insert" | "update" | "upsert" | "delete" = "select"
    private payload: Row | Row[] | null = null
    private conflict: string[] = []
    private readonly filters: ((r: Row) => boolean)[] = []
    private mode: "many" | "single" | "maybe" = "many"

    constructor(private readonly table: string) {}

    select() {
      return this
    }
    insert(v: Row | Row[]) {
      this.op = "insert"
      this.payload = v
      return this
    }
    update(v: Row) {
      this.op = "update"
      this.payload = v
      return this
    }
    upsert(v: Row, o?: { onConflict?: string }) {
      this.op = "upsert"
      this.payload = v
      this.conflict = (o?.onConflict ?? "id").split(",")
      return this
    }
    delete() {
      this.op = "delete"
      return this
    }
    eq(k: string, v: unknown) {
      this.filters.push((r) => r[k] === v)
      return this
    }
    in(k: string, v: unknown[]) {
      this.filters.push((r) => v.includes(r[k]))
      return this
    }
    gte() {
      return this
    }
    or() {
      return this
    }
    order() {
      return this
    }
    limit() {
      return this
    }
    single() {
      this.mode = "single"
      return this
    }
    maybeSingle() {
      this.mode = "maybe"
      return this
    }

    private result(): QueryResult {
      const rows = db[this.table]!
      let out: Row[] = []
      if (this.op === "select")
        out = rows.filter((r) => this.filters.every((f) => f(r)))
      if (this.op === "insert") {
        const list = (
          Array.isArray(this.payload) ? this.payload : [this.payload!]
        ).map((r) => ({ id: randomUUID(), ...r }))
        rows.push(...list)
        out = list
      }
      if (this.op === "update") {
        out = rows.filter((r) => this.filters.every((f) => f(r)))
        for (const r of out) Object.assign(r, this.payload)
      }
      if (this.op === "upsert") {
        const row = this.payload as Row
        const existing = rows.find((r) =>
          this.conflict.every((k) => r[k] === row[k])
        )
        if (existing) Object.assign(existing, row)
        else rows.push({ ...row })
        out = [existing ?? row]
      }
      if (this.op === "delete") {
        out = rows.filter((r) => this.filters.every((f) => f(r)))
        db[this.table] = rows.filter((r) => !out.includes(r))
      }
      const data = this.mode === "many" ? out : (out[0] ?? null)
      return { data, error: null }
    }

    then<TResult1 = QueryResult, TResult2 = never>(
      onfulfilled?:
        ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?:
        ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
    ): PromiseLike<TResult1 | TResult2> {
      return Promise.resolve(this.result()).then(onfulfilled, onrejected)
    }
  }

  const from = (table: string) => {
    db[table] ??= []
    return new FakeQuery(table)
  }
  return { client: { from } as unknown as SupabaseClient, db }
}
