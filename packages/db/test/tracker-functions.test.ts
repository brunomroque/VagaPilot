import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  resolveLocalSupabase,
  seedUsers,
  type LocalSupabase,
} from "./local-supabase.js"

/*
 * P3 tracker functions (migration tracker_status_functions): writes are atomic and scoped to
 * the caller. FKs alone do not stop A from pointing at B's rows, so the functions must.
 */

const local = await resolveLocalSupabase()

if (!local.ok) {
  if (process.env.VAGAPILOT_REQUIRE_SUPABASE === "1") {
    throw new Error(
      `[tracker] VAGAPILOT_REQUIRE_SUPABASE=1 but ${local.reason}`
    )
  }
  console.warn(
    `\n[tracker] SKIPPED — tracker function tests did not run: ${local.reason}\n`
  )
}

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

const MARKER = `tracker-fn-test-${Date.now()}`

describe.skipIf(!local.ok)(
  "tracker functions isolate users A (Marina) and B (Rafael)",
  () => {
    let admin: SupabaseClient
    let asA: SupabaseClient
    let anon: SupabaseClient
    let appA: string
    let appB: string
    let evidenceB: string

    async function insertApplication(
      userId: string,
      nextAction: string | null
    ) {
      const { data, error } = await admin
        .from("applications")
        .insert({
          user_id: userId,
          company: MARKER,
          role_title: "Cargo fictício",
          source: "outro",
          route: "manual",
          status: "enviada",
          next_action: nextAction,
        })
        .select("id")
        .single()
      if (error || !data)
        throw new Error(`insert application: ${error?.message}`)
      return String((data as { id: string }).id)
    }

    async function statusOf(id: string) {
      const { data } = await admin
        .from("applications")
        .select("status, next_action")
        .eq("id", id)
        .single()
      return data as { status: string; next_action: string | null }
    }

    beforeAll(async () => {
      if (!local.ok) return
      admin = clientFor(local.env, local.env.serviceRoleKey)
      anon = clientFor(local.env, local.env.anonKey)
      asA = await signedIn(local.env, seedUsers.a.email)
      appA = await insertApplication(seedUsers.a.id, null)
      appB = await insertApplication(seedUsers.b.id, "Ação de B")
      const { data } = await admin
        .from("evidences")
        .insert({
          user_id: seedUsers.b.id,
          application_id: appB,
          kind: "protocol_text",
        })
        .select("id")
        .single()
      evidenceB = String((data as { id: string }).id)
    })

    afterAll(async () => {
      if (!local.ok) return
      await admin.from("applications").delete().eq("company", MARKER)
    })

    it("anon cannot call the functions", async () => {
      const { error } = await anon.rpc("change_application_status", {
        p_application_id: appA,
        p_from: "enviada",
        p_to: "em_analise",
        p_source: "usuario",
      })
      expect(error).not.toBeNull()
    })

    it("A cannot change the status of B's application", async () => {
      const { error } = await asA.rpc("change_application_status", {
        p_application_id: appB,
        p_from: "enviada",
        p_to: "reprovada",
        p_source: "usuario",
      })
      expect(error?.message).toContain("application_not_found")
      expect((await statusOf(appB)).status).toBe("enviada")
    })

    it("A cannot attach B's evidence to her own change", async () => {
      const { error } = await asA.rpc("change_application_status", {
        p_application_id: appA,
        p_from: "enviada",
        p_to: "em_analise",
        p_source: "gmail",
        p_confidence: 0.95,
        p_evidence_id: evidenceB,
      })
      expect(error?.message).toContain("evidence_not_found")
      expect((await statusOf(appA)).status).toBe("enviada")
    })

    it("rejects a stale from-status (optimistic concurrency)", async () => {
      const { error } = await asA.rpc("change_application_status", {
        p_application_id: appA,
        p_from: "rascunho",
        p_to: "enviada",
        p_source: "usuario",
      })
      expect(error?.message).toContain("status_conflict")
    })

    it("CA10.2 a valid change updates the row and records one event with its source", async () => {
      const { data, error } = await asA.rpc("change_application_status", {
        p_application_id: appA,
        p_from: "enviada",
        p_to: "em_analise",
        p_source: "usuario",
      })
      expect(error).toBeNull()
      expect(data).toMatchObject({
        application_id: appA,
        type: "status_change",
        from_status: "enviada",
        to_status: "em_analise",
        source: "usuario",
        user_id: seedUsers.a.id,
      })
      expect((await statusOf(appA)).status).toBe("em_analise")
    })

    it("next action functions only touch the caller's rows", async () => {
      const setOther = await asA.rpc("set_application_next_action", {
        p_application_id: appB,
        p_next_action: "Invadir",
        p_due_at: null,
      })
      expect(setOther.error?.message).toContain("application_not_found")
      const doneOther = await asA.rpc("complete_application_action", {
        p_application_id: appB,
      })
      expect(doneOther.error?.message).toContain("application_not_found")
      expect((await statusOf(appB)).next_action).toBe("Ação de B")
    })

    it("sets and completes A's next action with deadline_set events", async () => {
      const empty = await asA.rpc("complete_application_action", {
        p_application_id: appA,
      })
      expect(empty.error?.message).toContain("no_pending_action")

      const set = await asA.rpc("set_application_next_action", {
        p_application_id: appA,
        p_next_action: "  Enviar teste  ",
        p_due_at: "2026-10-25T02:59:00Z",
      })
      expect(set.error).toBeNull()
      expect((await statusOf(appA)).next_action).toBe("Enviar teste")

      const done = await asA.rpc("complete_application_action", {
        p_application_id: appA,
      })
      expect(done.error).toBeNull()
      expect(done.data).toMatchObject({
        type: "deadline_set",
        source: "usuario",
        payload: { action: "Enviar teste", done: true },
      })
      expect((await statusOf(appA)).next_action).toBeNull()
    })
  }
)
