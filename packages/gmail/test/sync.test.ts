import { randomUUID } from "node:crypto"

import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { InMemoryAuditSink } from "@vagapilot/core/audit"
import {
  createFieldCrypto,
  InMemoryDekStore,
  LocalKeyProvider,
} from "@vagapilot/core/crypto"
import { formatDateTimeBR } from "@vagapilot/core/dates"
import { resolveLocalSupabase } from "@vagapilot/db/testing"
import { fromBytea } from "@vagapilot/db/server"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import {
  completeGmailConnection,
  revokeGmailConnection,
} from "../src/connection.js"
import { searchGmailForDuplicates } from "../src/duplicates.js"
import {
  ambiguousRejectionEmail,
  confirmationEmail,
  injectionEmails,
  interviewEmail,
  LGPD_FOOTER,
  linkedInAlertEmail,
  newsletterEmail,
  rejectionEmail,
  stageEmail,
  verificationCodeEmail,
} from "../src/fixtures/templates.js"
import {
  createFixtureGmailApi,
  createMemoryMailboxSource,
  createMockOAuthClient,
  deliverFixtureMessages,
  type FixtureGmailApi,
  type FixtureMessage,
  type MailboxSource,
} from "../src/mock.js"
import { createGmailRuntime, type GmailRuntime } from "../src/runtime.js"
import { scopeForKind } from "../src/scopes.js"
import { runGmailSync } from "../src/sync.js"

/*
 * P4 integration: sync pipeline on the local Supabase with a mocked Gmail API (fixture mailbox,
 * fake OAuth, fake classifier). No real network: only the local Supabase host is reachable.
 */

const local = await resolveLocalSupabase()
if (!local.ok) {
  if (process.env.VAGAPILOT_REQUIRE_SUPABASE === "1") {
    throw new Error(`[gmail] VAGAPILOT_REQUIRE_SUPABASE=1 but ${local.reason}`)
  }
  console.warn(
    `\n[gmail] SKIPPED — Gmail sync integration did not run: ${local.reason}\n`
  )
}

const HOUR = 3_600_000
const NOW = new Date("2026-10-22T13:00:00Z")
const COMPANY_A = "Empresa Fictícia Beta"
const COMPANY_B = "Cooperativa Fictícia Gama"
const COMPANY_C = "Instituto Fictício Delta"
const COMPANY_D = "Laboratório Fictício Ômega"

type Row = Record<string, unknown>

describe.skipIf(!local.ok)(
  "Gmail sync on local Supabase (mocked Gmail API)",
  () => {
    let admin: SupabaseClient
    let userId = ""
    let source: MailboxSource
    let oauth: ReturnType<typeof createMockOAuthClient>
    let audit: InMemoryAuditSink
    let runtime: GmailRuntime
    let api: FixtureGmailApi
    const hosts = new Set<string>()
    const logs: string[] = []
    const alerts: string[][] = []
    const apps: Record<string, string> = {}
    let revokeOnCall: (() => Promise<void>) | null = null

    const recordingFetch: typeof fetch = async (input, init) => {
      hosts.add(
        new URL(String(input instanceof Request ? input.url : input)).host
      )
      return fetch(input, init)
    }

    async function insertApplication(
      company: string,
      role: string,
      status: string
    ) {
      const { data, error } = await admin
        .from("applications")
        .insert({
          user_id: userId,
          company,
          role_title: role,
          source: "gupy",
          route: "extensao",
          status,
          applied_at: new Date(NOW.getTime() - 10 * 24 * HOUR).toISOString(),
          created_at: new Date(NOW.getTime() - 11 * 24 * HOUR).toISOString(),
        })
        .select("id")
        .single<{ id: string }>()
      if (error || !data) throw new Error(error?.message)
      return data.id
    }

    async function application(id: string) {
      const { data } = await admin
        .from("applications")
        .select("status, next_action, next_action_due_at")
        .eq("id", id)
        .single<{
          status: string
          next_action: string | null
          next_action_due_at: string | null
        }>()
      return data
    }

    async function threads(): Promise<Row[]> {
      const { data } = await admin
        .from("email_threads")
        .select("*")
        .eq("user_id", userId)
      return (data ?? []) as Row[]
    }

    async function deliver(messages: FixtureMessage[]) {
      await deliverFixtureMessages(source, userId, messages)
    }

    beforeAll(async () => {
      if (!local.ok) return
      admin = createClient(local.env.url, local.env.serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { fetch: recordingFetch },
      })
      const created = await admin.auth.admin.createUser({
        email: `gmail+${randomUUID()}@vagapilot.test`,
        password: "Ficticia#2026",
        email_confirm: true,
      })
      if (!created.data.user) throw new Error(created.error?.message)
      userId = created.data.user.id

      apps.loft = await insertApplication(
        COMPANY_A,
        "Gerente de Plataforma",
        "enviada"
      )
      apps.gama = await insertApplication(COMPANY_B, "Tech Lead", "em_analise")
      apps.delta = await insertApplication(
        COMPANY_C,
        "Engineering Manager",
        "etapa_pendente"
      )
      apps.omega = await insertApplication(
        COMPANY_D,
        "Head de Dados",
        "reprovada"
      )

      source = createMemoryMailboxSource()
      oauth = createMockOAuthClient({ now: () => NOW })
      audit = new InMemoryAuditSink()
      runtime = createGmailRuntime({
        admin,
        env: { NODE_ENV: "test", VAGAPILOT_GMAIL_MOCK: "1" },
        oauth,
        mailbox: source,
        fieldCrypto: createFieldCrypto({
          keyProvider: new LocalKeyProvider(Buffer.alloc(32, 7)),
          dekStore: new InMemoryDekStore(),
        }),
        api: () => {
          api = createFixtureGmailApi({
            source,
            userId,
            emailAddress: "conta.ficticia@gmail.test",
            now: () => NOW,
            onCall: async (method) => {
              if (method === "getMetadata" && revokeOnCall) {
                const revoke = revokeOnCall
                revokeOnCall = null
                await revoke()
              }
            },
          })
          return api
        },
        audit,
        log: (event, fields) =>
          logs.push(`${event} ${JSON.stringify(fields ?? {})}`),
        onJobAlert: async (batch) => {
          alerts.push(batch.urls)
        },
        now: () => NOW,
      })
    })

    afterAll(async () => {
      if (!local.ok || !userId) return
      await admin.auth.admin.deleteUser(userId)
    })

    beforeEach(() => {
      logs.length = 0
    })

    it("P4.1 stores the refresh token encrypted with the granted scopes", async () => {
      const result = await completeGmailConnection(runtime, {
        userId,
        kind: "leitura",
        code: `mock-code:${encodeURIComponent(scopeForKind("leitura"))}`,
        codeVerifier: "verificador",
        redirectUri: "http://127.0.0.1:3100/api/google/oauth/callback",
        emailHint: "conta.ficticia@gmail.test",
      })
      expect(result).toEqual({
        ok: true,
        googleEmail: "conta.ficticia@gmail.test",
        scopes: [scopeForKind("leitura")],
      })
      const { data } = await admin
        .from("gmail_connections")
        .select("refresh_token_enc, scopes, status")
        .eq("user_id", userId)
        .single<{
          refresh_token_enc: string
          scopes: string[]
          status: string
        }>()
      const sealed = fromBytea(data?.refresh_token_enc)
      expect(sealed).not.toBeNull()
      expect(Buffer.from(sealed!).toString("utf8")).not.toContain(
        "mock-refresh"
      )
      expect(
        await runtime.fieldCrypto.decryptFieldText(userId, sealed!)
      ).toMatch(/^mock-refresh-/)
      expect(data?.status).toBe("ativo")

      const send = await completeGmailConnection(runtime, {
        userId,
        kind: "envio",
        code: `mock-code:${encodeURIComponent(scopeForKind("envio"))}`,
        codeVerifier: "v",
        redirectUri: "http://127.0.0.1:3100/api/google/oauth/callback",
      })
      expect(send.ok && send.scopes.sort()).toEqual(
        [scopeForKind("leitura"), scopeForKind("envio")].sort()
      )
    })

    it("CA11.5 initial sync: confident updates with evidence, the rest to Revise, RF11.7 creation", async () => {
      const at = (hours: number) => new Date(NOW.getTime() - hours * HOUR)
      const deadline = formatDateTimeBR(new Date(NOW.getTime() + 36 * HOUR))
      await deliver([
        newsletterEmail({ id: "news", date: at(9) }),
        verificationCodeEmail({ id: "otp", date: at(8), code: "482913" }),
        stageEmail({
          id: "stage",
          date: at(7),
          company: COMPANY_A,
          role: "Gerente de Plataforma",
          deadlineText: deadline,
        }),
        interviewEmail({
          id: "invite",
          date: at(6),
          company: COMPANY_B,
          role: "Tech Lead",
          whenText: "26/10 às 14h",
        }),
        ambiguousRejectionEmail({
          id: "ambiguous",
          date: at(5),
          company: COMPANY_C,
          role: "Engineering Manager",
        }),
        interviewEmail({
          id: "terminal",
          date: at(4),
          company: COMPANY_D,
          role: "Head de Dados",
          whenText: "27/10 às 10h",
        }),
        confirmationEmail({
          id: "outside",
          date: at(3),
          company: "Acme Pagamentos",
          role: "Analista de Dados",
        }),
        linkedInAlertEmail({
          id: "alert",
          date: at(2),
          jobIds: ["4012345678", "4012345679"],
        }),
      ])

      const result = await runGmailSync(runtime, userId, "initial", {
        actor: "usuario",
      })
      expect(result).toMatchObject({
        status: "ok",
        mode: "initial",
        listed: 8,
        applied: 2,
        created: 1,
        verificationCodesSkipped: 1,
        alerts: 1,
        deadlines: 2,
      })

      // Automatic, with evidence and confidence (CA11.5).
      expect(await application(apps.loft!)).toEqual({
        status: "etapa_pendente",
        next_action: "Concluir teste ou etapa do processo",
        next_action_due_at: expect.stringMatching(/^2026-10-24T01:00:00/),
      })
      expect((await application(apps.gama!))?.status).toBe("entrevista")
      const { data: events } = await admin
        .from("application_events")
        .select("source, confidence, to_status, email_thread_id, evidence_id")
        .eq("application_id", apps.loft!)
        .eq("type", "status_change")
      expect(events).toEqual([
        {
          source: "gmail",
          confidence: 0.9,
          to_status: "etapa_pendente",
          email_thread_id: expect.any(String),
          evidence_id: expect.any(String),
        },
      ])
      const { data: evidence } = await admin
        .from("evidences")
        .select("kind, text_excerpt")
        .eq("id", (events as Row[])[0]?.evidence_id as string)
        .single<{ kind: string; text_excerpt: string }>()
      expect(evidence?.kind).toBe("email")
      expect(evidence?.text_excerpt).toContain(
        "De: InHire <notificacoes@inhire.app>"
      )
      expect(evidence?.text_excerpt).toContain(
        `Assunto: ${COMPANY_A} | Próxima etapa`
      )

      // Low confidence and terminal status never change automatically.
      expect((await application(apps.delta!))?.status).toBe("etapa_pendente")
      expect((await application(apps.omega!))?.status).toBe("reprovada")
      const stored = await threads()
      const review = stored.filter((row) => row.review_status === "revisar")
      expect(review.map((row) => row.gmail_message_id).sort()).toEqual([
        "ambiguous",
        "outside",
        "terminal",
      ])
      const reasons = Object.fromEntries(
        review.map((row) => [
          row.gmail_message_id,
          (row.extracted as { suggestion: { reason: string } }).suggestion
            .reason,
        ])
      )
      expect(reasons).toEqual({
        ambiguous: "needs_review",
        terminal: "terminal_requires_user",
        outside: "created_from_email",
      })

      // RF11.7: confirmation without application → `enviada`, source email, marked for review.
      const { data: createdApp } = await admin
        .from("applications")
        .select("status, source, company")
        .eq("user_id", userId)
        .eq("company", "Acme Pagamentos")
        .single()
      expect(createdApp).toEqual({
        status: "enviada",
        source: "email",
        company: "Acme Pagamentos",
      })

      // RF15.2 hook and the alert links kept as metadata.
      expect(alerts).toEqual([
        [
          "https://www.linkedin.com/jobs/view/4012345678/",
          "https://www.linkedin.com/jobs/view/4012345679/",
        ],
      ])

      // Mail outside the filter and verification codes are never opened (RF11.2, CA11.6).
      expect(api.openedBodies).not.toContain("news")
      expect(api.openedBodies).not.toContain("otp")
      expect(stored.map((row) => row.gmail_message_id)).not.toContain("otp")

      const { data: notifications } = await admin
        .from("notifications")
        .select("kind")
        .eq("user_id", userId)
      expect((notifications ?? []).map((row) => row.kind).sort()).toEqual([
        "review_needed",
        "status_changed",
        "status_changed",
      ])
      expect(audit.records.map((record) => record.action)).toContain(
        "gmail.synced"
      )
    })

    it("CA11.4 never persists or logs the full body (snippet ≤ 500)", async () => {
      const stored = await threads()
      expect(stored.length).toBeGreaterThan(0)
      for (const row of stored) {
        expect(String(row.snippet ?? "").length).toBeLessThanOrEqual(500)
        const serialized = JSON.stringify(row)
        expect(serialized).not.toContain(LGPD_FOOTER.slice(0, 60))
        expect(serialized).not.toContain("482913")
      }
      const { data: evidences } = await admin
        .from("evidences")
        .select("text_excerpt")
        .eq("user_id", userId)
      for (const row of evidences ?? []) {
        expect(String(row.text_excerpt)).not.toContain(LGPD_FOOTER.slice(0, 60))
      }
      await runGmailSync(runtime, userId, "initial")
      expect(logs.join("\n")).not.toMatch(
        /Recebemos sua candidatura|Infelizmente|LGPD|@/
      )
    })

    it("incremental sync reads only new history and skips stored messages", async () => {
      await deliver([
        rejectionEmail({
          id: "late-rejection",
          date: new Date(NOW.getTime() - HOUR),
          company: COMPANY_B,
          role: "Tech Lead",
        }),
      ])
      const result = await runGmailSync(runtime, userId, "incremental")
      expect(result).toMatchObject({
        status: "ok",
        mode: "incremental",
        listed: 1,
        applied: 1,
      })
      expect((await application(apps.gama!))?.status).toBe("reprovada")
    })

    it("CA11.7 0 actions from the prompt-injection corpus", async () => {
      const before = await admin
        .from("application_events")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
      const statusBefore = await application(apps.loft!)
      const notificationsBefore = await admin
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
      hosts.clear()
      const alertsBefore = alerts.length

      await deliver(
        injectionEmails(new Date(NOW.getTime() - 30 * 60_000), COMPANY_A)
      )
      const result = await runGmailSync(runtime, userId, "incremental")
      expect(result).toMatchObject({
        status: "ok",
        applied: 0,
        created: 0,
        review: 0,
        alerts: 0,
      })

      const after = await admin
        .from("application_events")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
      expect(after.count).toBe(before.count)
      expect(await application(apps.loft!)).toEqual(statusBefore)
      const notificationsAfter = await admin
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
      expect(notificationsAfter.count).toBe(notificationsBefore.count)
      expect(alerts.length).toBe(alertsBefore)
      expect(oauth.revoked).toEqual([])
      // The only network the pipeline touched is the local database.
      expect([...hosts]).toEqual([
        new URL(local.ok ? local.env.url : "http://x").host,
      ])
    })

    it("RF5.2 duplicate search answers within the budget or flags a partial check", async () => {
      const found = await searchGmailForDuplicates(
        userId,
        { company: COMPANY_A },
        { runtime }
      )
      expect(found.status).toBe("ok")
      expect(
        found.status !== "not_connected" && found.matches.length
      ).toBeGreaterThan(0)
      expect(found.status !== "not_connected" && found.elapsedMs).toBeLessThan(
        5_000
      )

      const slow = createGmailRuntime({
        admin,
        env: { NODE_ENV: "test", VAGAPILOT_GMAIL_MOCK: "1" },
        oauth,
        mailbox: source,
        fieldCrypto: runtime.fieldCrypto,
        audit,
        api: () => ({
          ...createFixtureGmailApi({
            source,
            userId,
            emailAddress: "x@gmail.test",
            now: () => NOW,
          }),
          getMetadata: (_id, options) =>
            new Promise((_, reject) =>
              options?.signal?.addEventListener("abort", () =>
                reject(new Error("abort"))
              )
            ),
        }),
      })
      const partial = await searchGmailForDuplicates(
        userId,
        { company: COMPANY_A },
        { runtime: slow, budgetMs: 200 }
      )
      expect(partial.status).toBe("partial")
    })

    it("CA11.3 revoking stops a running sync at once and deletes the token", async () => {
      await deliver([
        rejectionEmail({
          id: "after-revoke-1",
          date: new Date(NOW.getTime() - 20 * 60_000),
          company: COMPANY_C,
          role: "Engineering Manager",
        }),
        rejectionEmail({
          id: "after-revoke-2",
          date: new Date(NOW.getTime() - 10 * 60_000),
          company: COMPANY_A,
          role: "Gerente de Plataforma",
        }),
      ])
      revokeOnCall = async () => {
        await revokeGmailConnection(runtime, userId)
      }
      const result = await runGmailSync(runtime, userId, "incremental")
      expect(result).toMatchObject({ status: "stopped" })
      const stored = (await threads()).map((row) => row.gmail_message_id)
      expect(stored).not.toContain("after-revoke-2")
      expect((await application(apps.delta!))?.status).toBe("etapa_pendente")

      const { data } = await admin
        .from("gmail_connections")
        .select("user_id")
        .eq("user_id", userId)
      expect(data).toEqual([])
      expect(oauth.revoked).toHaveLength(1)
      expect(audit.records.map((record) => record.action)).toContain(
        "gmail.revoked"
      )
      expect(await runGmailSync(runtime, userId, "incremental")).toEqual({
        status: "not_connected",
      })
    })
  }
)
