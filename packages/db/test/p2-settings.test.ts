import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { resolveLocalSupabase, seedUsers } from "./local-supabase.js"

const local = await resolveLocalSupabase()

if (!local.ok) {
  if (process.env.VAGAPILOT_REQUIRE_SUPABASE === "1") {
    throw new Error(`[p2] VAGAPILOT_REQUIRE_SUPABASE=1 but ${local.reason}`)
  }
  console.warn(
    `\n[p2] SKIPPED — P2 settings tests did not run: ${local.reason}\n`
  )
}

const CHECK_VIOLATION = "23514"
const PERMISSION_DENIED = "42501"

/** P2.5 tables (F14): constraints and cross-user isolation beyond the generic RLS suite. */
describe.skipIf(!local.ok)(
  "P2 settings tables (F14) on the local Supabase",
  () => {
    let admin: SupabaseClient
    let asA: SupabaseClient
    const created: { table: string; id: string }[] = []

    beforeAll(async () => {
      if (!local.ok) return
      admin = createClient(local.env.url, local.env.serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
      asA = createClient(local.env.url, local.env.anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
      const { error } = await asA.auth.signInWithPassword({
        email: seedUsers.a.email,
        password: seedUsers.password,
      })
      if (error) throw new Error(error.message)
    })

    afterAll(async () => {
      for (const row of created.reverse())
        await admin.from(row.table).delete().eq("id", row.id)
    })

    it("A creates own saved search and memory event; B cannot see them", async () => {
      const search = await asA
        .from("saved_searches")
        .insert({
          user_id: seedUsers.a.id,
          query: "P2 RLS gerente",
          frequency: "semanal",
        })
        .select("id")
        .single()
      expect(search.error).toBeNull()
      created.push({ table: "saved_searches", id: search.data?.id as string })

      const memory = await asA
        .from("memory_events")
        .insert({
          user_id: seedUsers.a.id,
          intent: "create_saved_search",
          origin: "chat",
          utterance: "quero vagas de gerente",
          target_type: "saved_search",
          target_id: search.data?.id,
          after: { query: "P2 RLS gerente" },
        })
        .select("id")
        .single()
      expect(memory.error).toBeNull()
      created.push({ table: "memory_events", id: memory.data?.id as string })

      const asB = createClient(
        local.ok ? local.env.url : "",
        local.ok ? local.env.anonKey : "",
        {
          auth: { persistSession: false, autoRefreshToken: false },
        }
      )
      await asB.auth.signInWithPassword({
        email: seedUsers.b.email,
        password: seedUsers.password,
      })
      const seen = await asB
        .from("saved_searches")
        .select("id")
        .eq("id", search.data?.id as string)
      expect(seen.data).toEqual([])
      const forB = await asB.from("memory_events").insert({
        user_id: seedUsers.a.id,
        intent: "set_preference",
        origin: "chat",
        target_type: "preference",
      })
      expect(forB.error?.code).toBe(PERMISSION_DENIED)
    })

    it("constraints reject unknown preference keys, intents, approval modes and bad ranges", async () => {
      const preference = await asA
        .from("preferences")
        .insert({ user_id: seedUsers.a.id, key: "sql.injection", value: true })
      expect(preference.error?.code).toBe(CHECK_VIOLATION)

      const intent = await asA.from("memory_events").insert({
        user_id: seedUsers.a.id,
        intent: "send_email",
        origin: "chat",
        target_type: "x",
      })
      expect(intent.error?.code).toBe(CHECK_VIOLATION)

      const mode = await asA
        .from("user_settings")
        .update({ approval_mode: "autonomo_total" })
        .eq("user_id", seedUsers.a.id)
      expect(mode.error?.code).toBe(CHECK_VIOLATION)

      const range = await asA.from("saved_searches").insert({
        user_id: seedUsers.a.id,
        query: "SRE",
        salary_min: 30000,
        salary_max: 10000,
      })
      expect(range.error?.code).toBe(CHECK_VIOLATION)

      const ingestion = await asA
        .from("job_ingestions")
        .insert({ user_id: seedUsers.a.id, batch_id: crypto.randomUUID() })
      expect(ingestion.error?.code).toBe(CHECK_VIOLATION)
    })

    it("job_postings stay writable only by service_role while ingestion rows are per user", async () => {
      const posting = await asA.from("job_postings").insert({
        canonical_url: "https://vagas.exemplo.test/p2-rls",
        source: "outro",
        title: "x",
      })
      expect(posting.error?.code).toBe(PERMISSION_DENIED)

      const own = await asA
        .from("job_ingestions")
        .insert({
          user_id: seedUsers.a.id,
          batch_id: crypto.randomUUID(),
          input_url: "https://vagas.exemplo.test/p2",
        })
        .select("id")
        .single()
      expect(own.error).toBeNull()
      created.push({ table: "job_ingestions", id: own.data?.id as string })
      const others = await asA.from("job_ingestions").select("user_id")
      expect(others.data?.every((row) => row.user_id === seedUsers.a.id)).toBe(
        true
      )
    })
  }
)
