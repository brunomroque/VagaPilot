import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { is } from "drizzle-orm"
import { getTableConfig, PgTable } from "drizzle-orm/pg-core"
import { describe, expect, it } from "vitest"

import {
  adminTables,
  appendOnlyTables,
  globalReadTables,
  ownerCrudTables,
  ownerReadOnlyTables,
  serverOnlyTables,
} from "./access.js"
import * as enums from "./enums.js"
import * as schema from "./schema.js"

const migrationsDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../supabase/migrations"
)
const sql = readdirSync(migrationsDir)
  .filter((file) => file.endsWith(".sql"))
  .sort()
  .map((file) =>
    readFileSync(join(migrationsDir, file), "utf8").replace(/\r\n/g, "\n")
  )
  .join("\n")

function sqlTables(): Map<string, string[]> {
  const tables = new Map<string, string[]>()
  const tableRe = /create table public\.(\w+) \(\n([\s\S]*?)\n\);/g
  for (const match of sql.matchAll(tableRe)) {
    const [, name, body] = match
    if (!name || body === undefined) continue
    const columns = body
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !/^(unique|primary key|--)/.test(line))
      .map((line) => line.split(/\s+/)[0] ?? "")
    tables.set(name, columns)
  }
  const addColumnRe = /alter table public\.(\w+) add column (\w+)/g
  for (const [, name, column] of sql.matchAll(addColumnRe)) {
    if (name && column) tables.get(name)?.push(column)
  }
  return tables
}

function sqlEnums(): Map<string, string[]> {
  const result = new Map<string, string[]>()
  const enumRe = /create type public\.(\w+) as enum\s*\(([^)]*)\)/g
  for (const match of sql.matchAll(enumRe)) {
    const [, name, body] = match
    if (!name || body === undefined) continue
    result.set(
      name,
      [...body.matchAll(/'([^']+)'/g)].map((value) => value[1] ?? "")
    )
  }
  return result
}

const drizzleTables = (Object.values(schema) as unknown[])
  .filter((value): value is PgTable => is(value, PgTable))
  .map((table) => getTableConfig(table))

describe("Drizzle schema mirrors supabase/migrations (spec 9)", () => {
  const tables = sqlTables()

  it("declares the same tables", () => {
    expect(drizzleTables.map((t) => t.name).sort()).toEqual(
      [...tables.keys()].sort()
    )
  })

  it.each(drizzleTables.map((t) => [t.name, t] as const))(
    "%s has the same columns",
    (name, config) => {
      expect(config.columns.map((c) => c.name).sort()).toEqual(
        [...(tables.get(name) ?? [])].sort()
      )
    }
  )

  it("declares the same enums and values", () => {
    const drizzleEnums = new Map(
      Object.values(enums)
        .filter(
          (value): value is typeof enums.applicationStatus =>
            typeof value === "function" && "enumName" in value
        )
        .map((pgEnum) => [pgEnum.enumName, [...pgEnum.enumValues]])
    )
    expect(drizzleEnums).toEqual(sqlEnums())
  })

  it("creates evidences and email_threads before application_events", () => {
    const order = [...tables.keys()]
    const events = order.indexOf("application_events")
    expect(order.indexOf("evidences")).toBeLessThan(events)
    expect(order.indexOf("email_threads")).toBeLessThan(events)
  })

  it("assigns every table to exactly one access model", () => {
    const assigned = [
      ...ownerCrudTables,
      ...ownerReadOnlyTables,
      ...appendOnlyTables,
      ...globalReadTables,
      ...serverOnlyTables,
      ...adminTables,
    ]
    expect(new Set(assigned).size).toBe(assigned.length)
    expect([...assigned].sort()).toEqual([...tables.keys()].sort())
  })

  it("enables RLS on every table", () => {
    for (const name of tables.keys()) {
      const inLoop = (ownerCrudTables as readonly string[]).includes(name)
      const explicit = sql.includes(
        `alter table public.${name} enable row level security`
      )
      expect(inLoop || explicit, name).toBe(true)
    }
    expect(sql).toContain(
      "execute format('alter table public.%I enable row level security', t)"
    )
  })

  it("uses the (select auth.uid()) form in policies", () => {
    expect(sql).not.toMatch(/using \(\s*auth\.uid\(\)/)
    expect(sql).not.toMatch(/user_id = auth\.uid\(\)/)
  })

  it("CA11.4 email_threads stores metadata and a ≤ 500 char snippet, never the body", () => {
    const columns = tables.get("email_threads") ?? []
    expect(columns).toContain("snippet")
    expect(
      columns.filter((column) => /body|html|raw|payload|content/.test(column))
    ).toEqual([])
    expect(sql).toMatch(
      /check \(snippet is null or char_length\(snippet\) <= 500\)/
    )
  })

  it("revokes update and delete on audit_log", () => {
    expect(sql).toMatch(
      /revoke update, delete, truncate on table public\.audit_log from anon, authenticated, service_role/
    )
  })
})
