import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { beforeAll, describe, expect, it } from "vitest"

import {
  appendOnlyTables,
  globalReadTables,
  ownerCrudTables,
  ownerReadOnlyTables,
  privateBuckets,
  serverOnlyTables,
  userKeyedTables,
} from "../src/access.js"
import {
  resolveLocalSupabase,
  seedUsers,
  type LocalSupabase,
} from "./local-supabase.js"

const local = await resolveLocalSupabase()

if (!local.ok) {
  if (process.env.VAGAPILOT_REQUIRE_SUPABASE === "1") {
    throw new Error(`[rls] VAGAPILOT_REQUIRE_SUPABASE=1 but ${local.reason}`)
  }
  console.warn(
    `\n[rls] SKIPPED — RLS isolation tests did not run: ${local.reason}\n`
  )
}

const PERMISSION_DENIED = "42501"

type Row = Record<string, unknown>

function clientFor(env: LocalSupabase, key: string): SupabaseClient {
  return createClient(env.url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function signedIn(
  env: LocalSupabase,
  email: string
): Promise<SupabaseClient> {
  const client = clientFor(env, env.anonKey)
  const { error } = await client.auth.signInWithPassword({
    email,
    password: seedUsers.password,
  })
  if (error) throw new Error(`sign in failed for ${email}: ${error.message}`)
  return client
}

async function rowsOf(
  admin: SupabaseClient,
  table: string,
  userId: string
): Promise<Row[]> {
  const { data, error } = await admin
    .from(table)
    .select("*")
    .eq("user_id", userId)
  if (error) throw new Error(`${table}: ${error.message}`)
  return data as Row[]
}

/** Copies a row of B so A can try to insert it with user_id = B. */
function cloneForInsert(table: string, row: Row): Row {
  const copy: Row = { ...row }
  if (!(userKeyedTables as readonly string[]).includes(table)) delete copy.id
  return copy
}

describe.skipIf(!local.ok)(
  "RLS isolation between fictitious users A (Marina) and B (Rafael)",
  () => {
    let admin: SupabaseClient
    let asA: SupabaseClient
    let anon: SupabaseClient

    beforeAll(async () => {
      if (!local.ok) return
      admin = clientFor(local.env, local.env.serviceRoleKey)
      asA = await signedIn(local.env, seedUsers.a.email)
      anon = clientFor(local.env, local.env.anonKey)
    })

    describe.each(ownerCrudTables)("%s (owner CRUD)", (table) => {
      it("seed has rows for B", async () => {
        expect(
          (await rowsOf(admin, table, seedUsers.b.id)).length
        ).toBeGreaterThan(0)
      })

      it("A only reads own rows", async () => {
        const { data, error } = await asA.from(table).select("user_id")
        expect(error).toBeNull()
        expect(data?.length).toBeGreaterThan(0)
        expect(data?.every((row) => row.user_id === seedUsers.a.id)).toBe(true)

        const targeted = await asA
          .from(table)
          .select("*")
          .eq("user_id", seedUsers.b.id)
        expect(targeted.data).toEqual([])
      })

      it("A cannot update B rows", async () => {
        const before = await rowsOf(admin, table, seedUsers.b.id)
        const { data } = await asA
          .from(table)
          .update({ user_id: seedUsers.a.id })
          .eq("user_id", seedUsers.b.id)
          .select()
        expect(data ?? []).toEqual([])
        expect(await rowsOf(admin, table, seedUsers.b.id)).toEqual(before)
      })

      it("A cannot delete B rows", async () => {
        const before = await rowsOf(admin, table, seedUsers.b.id)
        const { data } = await asA
          .from(table)
          .delete()
          .eq("user_id", seedUsers.b.id)
          .select()
        expect(data ?? []).toEqual([])
        expect((await rowsOf(admin, table, seedUsers.b.id)).length).toBe(
          before.length
        )
      })

      it("A cannot insert rows owned by B", async () => {
        const [row] = await rowsOf(admin, table, seedUsers.b.id)
        expect(row).toBeDefined()
        const { error } = await asA
          .from(table)
          .insert(cloneForInsert(table, row ?? {}))
        expect(error?.code).toBe(PERMISSION_DENIED)
      })
    })

    describe.each(ownerReadOnlyTables)(
      "%s (owner read-only, service_role writes)",
      (table) => {
        it("A reads only own rows", async () => {
          const { data, error } = await asA.from(table).select("user_id")
          expect(error).toBeNull()
          expect(data?.length).toBeGreaterThan(0)
          expect(data?.every((row) => row.user_id === seedUsers.a.id)).toBe(
            true
          )
        })

        it("A cannot write, not even own rows", async () => {
          const [own] = await rowsOf(admin, table, seedUsers.a.id)
          const insert = await asA
            .from(table)
            .insert(cloneForInsert(table, own ?? {}))
          expect(insert.error?.code).toBe(PERMISSION_DENIED)
          const update = await asA
            .from(table)
            .update({ user_id: seedUsers.a.id })
            .eq("user_id", seedUsers.a.id)
          expect(update.error?.code).toBe(PERMISSION_DENIED)
          const remove = await asA
            .from(table)
            .delete()
            .eq("user_id", seedUsers.b.id)
          expect(remove.error?.code).toBe(PERMISSION_DENIED)
        })
      }
    )

    // Empty while audit writes go through service_role. A string array keeps
    // describe.each from inferring `never` and failing tsc.
    describe.each(appendOnlyTables as readonly string[])(
      "%s (append-only)",
      (table) => {
        it("A reads only own entries", async () => {
          const { data } = await asA.from(table).select("user_id")
          expect(data?.length).toBeGreaterThan(0)
          expect(data?.every((row) => row.user_id === seedUsers.a.id)).toBe(
            true
          )
        })

        it("A appends own entries but not entries for B", async () => {
          const own = await asA.from(table).insert({
            user_id: seedUsers.a.id,
            actor: "usuario",
            action: "rls.test",
          })
          expect(own.error).toBeNull()
          const forB = await asA.from(table).insert({
            user_id: seedUsers.b.id,
            actor: "usuario",
            action: "rls.test",
          })
          expect(forB.error?.code).toBe(PERMISSION_DENIED)
        })

        it("nobody updates or deletes through the API", async () => {
          const update = await asA
            .from(table)
            .update({ action: "tampered" })
            .eq("user_id", seedUsers.a.id)
          expect(update.error?.code).toBe(PERMISSION_DENIED)
          const remove = await asA
            .from(table)
            .delete()
            .eq("user_id", seedUsers.a.id)
          expect(remove.error?.code).toBe(PERMISSION_DENIED)
          const adminUpdate = await admin
            .from(table)
            .update({ action: "tampered" })
            .eq("user_id", seedUsers.b.id)
          expect(adminUpdate.error?.code).toBe(PERMISSION_DENIED)
          const adminDelete = await admin
            .from(table)
            .delete()
            .eq("user_id", seedUsers.b.id)
          expect(adminDelete.error?.code).toBe(PERMISSION_DENIED)
        })
      }
    )

    describe.each(globalReadTables)("%s (global read)", (table) => {
      it("authenticated users read every posting", async () => {
        const { data, error } = await asA.from(table).select("id")
        expect(error).toBeNull()
        expect(data?.length).toBeGreaterThanOrEqual(2)
      })

      it("authenticated users cannot write", async () => {
        const insert = await asA.from(table).insert({
          canonical_url: "https://vagas.exemplo.test/rls",
          source: "outro",
          title: "RLS",
        })
        expect(insert.error?.code).toBe(PERMISSION_DENIED)
        const update = await asA
          .from(table)
          .update({ title: "x" })
          .neq("id", "00000000-0000-0000-0000-000000000000")
        expect(update.error?.code).toBe(PERMISSION_DENIED)
        const remove = await asA
          .from(table)
          .delete()
          .neq("id", "00000000-0000-0000-0000-000000000000")
        expect(remove.error?.code).toBe(PERMISSION_DENIED)
      })

      it("anonymous users cannot read", async () => {
        const { data, error } = await anon.from(table).select("id")
        expect(
          error?.code ?? (data?.length === 0 ? PERMISSION_DENIED : "")
        ).toBe(PERMISSION_DENIED)
      })
    })

    describe.each(serverOnlyTables)("%s (server only)", (table) => {
      it("authenticated users have no access", async () => {
        const { error } = await asA.from(table).select("*")
        expect(error?.code).toBe(PERMISSION_DENIED)
      })
    })

    it("anonymous users cannot read user data", async () => {
      for (const table of ownerCrudTables) {
        const { data, error } = await anon.from(table).select("*")
        expect(
          error?.code ?? (data?.length === 0 ? PERMISSION_DENIED : ""),
          table
        ).toBe(PERMISSION_DENIED)
      }
    })

    describe.each(privateBuckets)("storage bucket %s", (bucket) => {
      const fileFor = (userId: string) => `${userId}/rls-test.txt`

      beforeAll(async () => {
        await admin.storage
          .from(bucket)
          .upload(
            fileFor(seedUsers.b.id),
            new Blob(["B"], { type: "text/plain" }),
            { upsert: true }
          )
      })

      it("is private", async () => {
        const { data } = await admin.storage.getBucket(bucket)
        expect(data?.public).toBe(false)
      })

      it("A cannot read B files", async () => {
        const download = await asA.storage
          .from(bucket)
          .download(fileFor(seedUsers.b.id))
        expect(download.data).toBeNull()
        const list = await asA.storage.from(bucket).list(seedUsers.b.id)
        expect(list.data ?? []).toEqual([])
      })

      it("A cannot write into B folder", async () => {
        const upload = await asA.storage
          .from(bucket)
          .upload(
            `${seedUsers.b.id}/intruso.txt`,
            new Blob(["A"], { type: "text/plain" })
          )
        expect(upload.error).not.toBeNull()
      })

      it("A cannot delete B files", async () => {
        await asA.storage.from(bucket).remove([fileFor(seedUsers.b.id)])
        const stillThere = await admin.storage
          .from(bucket)
          .download(fileFor(seedUsers.b.id))
        expect(stillThere.error).toBeNull()
      })
    })

    it("A can upload CVs into own folder", async () => {
      const path = `${seedUsers.a.id}/rls-own.txt`
      const upload = await asA.storage
        .from("cvs")
        .upload(path, new Blob(["A"], { type: "text/plain" }), { upsert: true })
      expect(upload.error).toBeNull()
      await admin.storage.from("cvs").remove([path])
    })
  }
)
