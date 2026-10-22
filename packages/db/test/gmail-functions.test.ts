import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  resolveLocalSupabase,
  seedUsers,
  type LocalSupabase,
} from "./local-supabase.js"

/*
 * P4 Gmail (migration p4_gmail): the background sync writes with service_role through
 * gmail_* functions that take an explicit user id. They must never cross users, never run for
 * clients, and keep the automatic-update invariants of 9.4. The OAuth token column is not
 * readable by its owner (12.3).
 */

const local = await resolveLocalSupabase()

if (!local.ok) {
  if (process.env.VAGAPILOT_REQUIRE_SUPABASE === "1") {
    throw new Error(`[gmail] VAGAPILOT_REQUIRE_SUPABASE=1 but ${local.reason}`)
  }
  console.warn(
    `\n[gmail] SKIPPED — Gmail function tests did not run: ${local.reason}\n`
  )
}

const PERMISSION_DENIED = "42501"
const CHECK_VIOLATION = "23514"
const MARKER = `gmail-fn-test-${Date.now()}`

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

describe.skipIf(!local.ok)(
  "Gmail service functions and token isolation",
  () => {
    let admin: SupabaseClient
    let asA: SupabaseClient
    let anon: SupabaseClient
    let appA = ""
    let appATerminal = ""
    let threadA = ""
    let threadB = ""

    async function insertApplication(userId: string, status: string) {
      const { data, error } = await admin
        .from("applications")
        .insert({
          user_id: userId,
          company: MARKER,
          role_title: "Cargo fictício",
          source: "outro",
          route: "manual",
          status,
        })
        .select("id")
        .single<{ id: string }>()
      if (error || !data)
        throw new Error(`insert application: ${error?.message}`)
      return data.id
    }

    async function insertThread(userId: string, suffix: string) {
      const { data, error } = await admin
        .from("email_threads")
        .insert({
          user_id: userId,
          gmail_thread_id: `${MARKER}-t-${suffix}`,
          gmail_message_id: `${MARKER}-m-${suffix}`,
          from_domain: "gupy.io",
          subject: "Mensagem fictícia",
          received_at: new Date().toISOString(),
          snippet: "Trecho fictício.",
          classification: "reprovacao",
          confidence: 0.95,
        })
        .select("id")
        .single<{ id: string }>()
      if (error || !data) throw new Error(`insert thread: ${error?.message}`)
      return data.id
    }

    async function statusOf(id: string) {
      const { data } = await admin
        .from("applications")
        .select("status, next_action")
        .eq("id", id)
        .single<{ status: string; next_action: string | null }>()
      return data
    }

    beforeAll(async () => {
      if (!local.ok) return
      admin = clientFor(local.env, local.env.serviceRoleKey)
      anon = clientFor(local.env, local.env.anonKey)
      asA = await signedIn(local.env, seedUsers.a.email)
      appA = await insertApplication(seedUsers.a.id, "enviada")
      appATerminal = await insertApplication(seedUsers.a.id, "reprovada")
      threadA = await insertThread(seedUsers.a.id, "a")
      threadB = await insertThread(seedUsers.b.id, "b")
    })

    afterAll(async () => {
      if (!local.ok) return
      await admin.from("applications").delete().eq("company", MARKER)
      await admin
        .from("email_threads")
        .delete()
        .like("gmail_message_id", `${MARKER}%`)
    })

    it("the owner reads her connection but never the refresh token column (12.3)", async () => {
      const own = await asA
        .from("gmail_connections")
        .select("google_email, scopes, status")
      expect(own.error).toBeNull()
      expect(own.data?.length).toBe(1)

      const token = await asA
        .from("gmail_connections")
        .select("refresh_token_enc")
      expect(token.error?.code).toBe(PERMISSION_DENIED)
      const star = await asA.from("gmail_connections").select("*")
      expect(star.error?.code).toBe(PERMISSION_DENIED)
    })

    it("clients cannot call the service functions", async () => {
      const args = {
        p_user_id: seedUsers.a.id,
        p_application_id: appA,
        p_from: "enviada",
        p_to: "em_analise",
        p_confidence: 0.95,
        p_email_thread_id: threadA,
      }
      for (const client of [asA, anon]) {
        const change = await client.rpc("gmail_change_application_status", args)
        expect(change.error).not.toBeNull()
        const next = await client.rpc("gmail_set_application_next_action", {
          p_user_id: seedUsers.a.id,
          p_application_id: appA,
          p_next_action: "Invadir",
          p_due_at: null,
          p_email_thread_id: threadA,
        })
        expect(next.error).not.toBeNull()
      }
      expect((await statusOf(appA))?.status).toBe("enviada")
    })

    it("service_role cannot write A's application as B or with B's thread", async () => {
      const asB = await admin.rpc("gmail_change_application_status", {
        p_user_id: seedUsers.b.id,
        p_application_id: appA,
        p_from: "enviada",
        p_to: "reprovada",
        p_confidence: 0.95,
        p_email_thread_id: threadB,
      })
      expect(asB.error?.message).toContain("application_not_found")

      const foreignThread = await admin.rpc("gmail_change_application_status", {
        p_user_id: seedUsers.a.id,
        p_application_id: appA,
        p_from: "enviada",
        p_to: "reprovada",
        p_confidence: 0.95,
        p_email_thread_id: threadB,
      })
      expect(foreignThread.error?.message).toContain("email_thread_not_found")

      const nextAsB = await admin.rpc("gmail_set_application_next_action", {
        p_user_id: seedUsers.b.id,
        p_application_id: appA,
        p_next_action: "Concluir teste",
        p_due_at: null,
        p_email_thread_id: threadB,
      })
      expect(nextAsB.error?.message).toContain("application_not_found")
      expect(await statusOf(appA)).toEqual({
        status: "enviada",
        next_action: null,
      })
    })

    it("CA11.5 keeps the automatic invariants: no terminal exit, no apply below 0.8", async () => {
      const terminal = await admin.rpc("gmail_change_application_status", {
        p_user_id: seedUsers.a.id,
        p_application_id: appATerminal,
        p_from: "reprovada",
        p_to: "entrevista",
        p_confidence: 0.99,
        p_email_thread_id: threadA,
      })
      expect(terminal.error?.message).toContain("terminal_requires_user")

      const low = await admin.rpc("gmail_change_application_status", {
        p_user_id: seedUsers.a.id,
        p_application_id: appA,
        p_from: "enviada",
        p_to: "reprovada",
        p_confidence: 0.79,
        p_email_thread_id: threadA,
      })
      expect(low.error?.message).toContain("needs_review")
      expect((await statusOf(appA))?.status).toBe("enviada")
    })

    it("applies a valid change with source gmail, confidence and the e-mail thread", async () => {
      const { data, error } = await admin.rpc(
        "gmail_change_application_status",
        {
          p_user_id: seedUsers.a.id,
          p_application_id: appA,
          p_from: "enviada",
          p_to: "reprovada",
          p_confidence: 0.92,
          p_email_thread_id: threadA,
        }
      )
      expect(error).toBeNull()
      expect(data).toMatchObject({
        user_id: seedUsers.a.id,
        application_id: appA,
        from_status: "enviada",
        to_status: "reprovada",
        source: "gmail",
        confidence: 0.92,
        email_thread_id: threadA,
      })

      const next = await admin.rpc("gmail_set_application_next_action", {
        p_user_id: seedUsers.a.id,
        p_application_id: appA,
        p_next_action: "Pedir feedback",
        p_due_at: "2026-10-25T02:59:00Z",
        p_email_thread_id: threadA,
      })
      expect(next.error).toBeNull()
      expect(next.data).toMatchObject({ type: "deadline_set", source: "gmail" })
      expect(await statusOf(appA)).toEqual({
        status: "reprovada",
        next_action: "Pedir feedback",
      })
    })

    it("CA11.4 the database refuses snippets longer than 500 characters", async () => {
      const { error } = await admin.from("email_threads").insert({
        user_id: seedUsers.a.id,
        gmail_thread_id: `${MARKER}-long`,
        gmail_message_id: `${MARKER}-long`,
        received_at: new Date().toISOString(),
        snippet: "x".repeat(501),
      })
      expect(error?.code).toBe(CHECK_VIOLATION)
    })
  }
)
