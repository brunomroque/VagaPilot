import { randomUUID } from "node:crypto"

import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { resolveLocalSupabase } from "@vagapilot/db/testing"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import {
  createLogMailer,
  createMailerFromEnv,
  createResendMailer,
  RESEND_API_URL,
  type MailMessage,
  type Mailer,
} from "../src/mailer.js"
import { runDueReminders } from "../src/reminders.js"

describe("transactional mailer (Resend, RF11.6)", () => {
  it("uses a logging no-op transport without RESEND_API_KEY", async () => {
    expect(createMailerFromEnv({}).kind).toBe("log")
    const lines: string[] = []
    const result = await createLogMailer((line) => lines.push(line)).send({
      to: "marina@vagapilot.test",
      subject: "Lembrete",
      text: "Conteúdo",
      idempotencyKey: "reminder:x",
    })
    expect(result.status).toBe("logged")
    expect(lines.join(" ")).not.toContain("marina@")
  })

  it("posts to Resend with an idempotency key (mocked, no network)", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ id: "email-1" }), { status: 200 })
    )
    const mailer = createResendMailer({
      apiKey: "re_ficticia",
      from: "VagaPilot <lembretes@vagapilot.test>",
      fetch: fetchMock as unknown as typeof fetch,
    })
    const result = await mailer.send({
      to: "marina@vagapilot.test",
      subject: "Lembrete",
      text: "Prazo",
      idempotencyKey: "reminder:app:1:48h",
    })
    expect(result).toEqual({ status: "sent", id: "email-1" })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    expect(url).toBe(RESEND_API_URL)
    expect(new Headers(init.headers).get("idempotency-key")).toBe(
      "reminder:app:1:48h"
    )
  })
})

const local = await resolveLocalSupabase()
if (!local.ok) {
  if (process.env.VAGAPILOT_REQUIRE_SUPABASE === "1") {
    throw new Error(`[jobs] VAGAPILOT_REQUIRE_SUPABASE=1 but ${local.reason}`)
  }
  console.warn(
    `\n[jobs] SKIPPED — reminders integration did not run: ${local.reason}\n`
  )
}

describe.skipIf(!local.ok)(
  "RF11.6 reminders 48 h and 12 h before deadlines (local Supabase)",
  () => {
    let admin: SupabaseClient
    let userId = ""
    let applicationId = ""
    const sent: MailMessage[] = []
    const mailer: Mailer = {
      kind: "resend",
      send: async (message) => {
        sent.push(message)
        return { status: "sent" }
      },
    }
    const due = new Date("2026-10-26T02:59:00Z")
    const hoursBefore = (hours: number) => () =>
      new Date(due.getTime() - hours * 3_600_000)

    beforeAll(async () => {
      if (!local.ok) return
      admin = createClient(local.env.url, local.env.serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
      const email = `lembrete+${randomUUID().slice(0, 8)}@vagapilot.test`
      const created = await admin.auth.admin.createUser({
        email,
        password: "Ficticia#2026",
        email_confirm: true,
      })
      if (!created.data.user) throw new Error(created.error?.message)
      userId = created.data.user.id
      const { data } = await admin
        .from("applications")
        .insert({
          user_id: userId,
          company: "Empresa Fictícia Beta",
          role_title: "Gerente de Plataforma",
          source: "gupy",
          status: "etapa_pendente",
          next_action: "Concluir teste ou etapa do processo",
          next_action_due_at: due.toISOString(),
        })
        .select("id")
        .single<{ id: string }>()
      applicationId = data?.id ?? ""
    })

    afterAll(async () => {
      if (local.ok && userId) await admin.auth.admin.deleteUser(userId)
    })

    it("sends nothing more than 48 h before", async () => {
      const result = await runDueReminders(
        { admin, mailer, now: hoursBefore(60) },
        { userId }
      )
      expect(result).toEqual({ due: 0, notified: 0, emailed: 0, failed: 0 })
    })

    it("sends the 48 h reminder once (bell + e-mail)", async () => {
      const first = await runDueReminders(
        { admin, mailer, now: hoursBefore(40), appUrl: "http://app.test" },
        { userId }
      )
      expect(first).toEqual({ due: 1, notified: 1, emailed: 1, failed: 0 })
      const again = await runDueReminders(
        { admin, mailer, now: hoursBefore(39) },
        { userId }
      )
      expect(again).toMatchObject({ due: 1, notified: 0, emailed: 0 })
      expect(sent).toHaveLength(1)
      expect(sent[0]?.subject).toBe(
        "Lembrete: Concluir teste ou etapa do processo — Empresa Fictícia Beta"
      )
      expect(sent[0]?.text).toContain(
        "Prazo: 25/10/2026 23:59 (horário de Brasília)."
      )
      expect(sent[0]?.text).toContain("http://app.test/app/acoes")
    })

    it("sends the 12 h reminder, then nothing after the deadline", async () => {
      expect(
        await runDueReminders(
          { admin, mailer, now: hoursBefore(10) },
          { userId }
        )
      ).toMatchObject({
        notified: 1,
        emailed: 1,
      })
      expect(
        await runDueReminders(
          { admin, mailer, now: hoursBefore(-1) },
          { userId }
        )
      ).toMatchObject({
        due: 0,
      })
      const { data } = await admin
        .from("notifications")
        .select("kind, params, email_sent_at, application_id")
        .eq("user_id", userId)
        .order("created_at")
      expect(
        data?.map((row) => (row.params as { window: string }).window)
      ).toEqual(["48h", "12h"])
      expect(
        data?.every(
          (row) => row.kind === "deadline_reminder" && row.email_sent_at
        )
      ).toBe(true)
      expect(data?.[0]?.application_id).toBe(applicationId)
    })
  }
)
