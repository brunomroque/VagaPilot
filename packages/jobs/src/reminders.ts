import process from "node:process"

import type { SupabaseClient } from "@supabase/supabase-js"
import { formatDateTimeBR } from "@vagapilot/core/dates"
import {
  dueReminderWindow,
  reminderDedupeKey,
  reminderWindowHours,
  type ReminderWindow,
} from "@vagapilot/core/reminders"
import { z } from "zod"

import type { Mailer } from "./mailer.js"

/**
 * Deadline reminders 48 h and 12 h before (RF11.6, P4.3): one in-app notification (topbar bell)
 * and one transactional e-mail per application, deadline and window. Runs with service_role,
 * every query filtered by user id.
 */

const rowSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  company: z.string(),
  role_title: z.string(),
  next_action: z.string(),
  next_action_due_at: z.string(),
})

export type ReminderRunResult = {
  due: number
  notified: number
  emailed: number
  failed: number
}

export type ReminderDeps = {
  admin: SupabaseClient
  mailer: Mailer
  now?: () => Date
  appUrl?: string
}

function reminderText(input: {
  window: ReminderWindow
  action: string
  company: string
  role: string
  dueAt: Date
  appUrl: string
}): { subject: string; text: string } {
  const hours = reminderWindowHours(input.window)
  return {
    subject: `Lembrete: ${input.action} — ${input.company}`,
    text: [
      "Olá!",
      "",
      `Faltam cerca de ${hours} horas para o prazo de "${input.action}" na candidatura ${input.role} · ${input.company}.`,
      `Prazo: ${formatDateTimeBR(input.dueAt)} (horário de Brasília).`,
      "",
      `Ver suas ações: ${input.appUrl}/app/acoes`,
      "",
      "Você recebe este lembrete porque a candidatura tem um prazo registrado no VagaPilot.",
    ].join("\n"),
  }
}

/** Sends every reminder due now. `userId` limits the run to one user ("Sincronizar agora"). */
export async function runDueReminders(
  deps: ReminderDeps,
  options: { userId?: string } = {}
): Promise<ReminderRunResult> {
  const now = deps.now?.() ?? new Date()
  const appUrl = (
    deps.appUrl ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "http://127.0.0.1:3000"
  ).replace(/\/$/, "")
  let query = deps.admin
    .from("applications")
    .select("id, user_id, company, role_title, next_action, next_action_due_at")
    .not("next_action", "is", null)
    .gt("next_action_due_at", now.toISOString())
    .lte(
      "next_action_due_at",
      new Date(now.getTime() + 48 * 3_600_000).toISOString()
    )
    .limit(1000)
  if (options.userId) query = query.eq("user_id", options.userId)
  const { data, error } = await query
  if (error) throw new Error(`reminders: ${error.message}`)

  const result: ReminderRunResult = {
    due: 0,
    notified: 0,
    emailed: 0,
    failed: 0,
  }
  const emails = new Map<string, string | null>()

  for (const raw of data ?? []) {
    const parsed = rowSchema.safeParse(raw)
    if (!parsed.success) continue
    const row = parsed.data
    const dueAt = new Date(row.next_action_due_at)
    const window = dueReminderWindow(dueAt, now)
    if (!window) continue
    result.due += 1

    const dedupeKey = reminderDedupeKey(row.id, dueAt, window)
    const { data: inserted, error: insertError } = await deps.admin
      .from("notifications")
      .upsert(
        {
          user_id: row.user_id,
          kind: "deadline_reminder",
          params: {
            company: row.company,
            action: row.next_action,
            due_at: dueAt.toISOString(),
            window,
          },
          application_id: row.id,
          dedupe_key: dedupeKey,
        },
        { onConflict: "user_id,dedupe_key", ignoreDuplicates: true }
      )
      .select("id")
    if (insertError) throw new Error(`reminders: ${insertError.message}`)
    const notificationId = (inserted as { id: string }[] | null)?.[0]?.id
    if (!notificationId) continue
    result.notified += 1

    if (!emails.has(row.user_id)) {
      const user = await deps.admin.auth.admin.getUserById(row.user_id)
      emails.set(row.user_id, user.data.user?.email ?? null)
    }
    const to = emails.get(row.user_id)
    if (!to) continue
    const message = reminderText({
      window,
      action: row.next_action,
      company: row.company,
      role: row.role_title,
      dueAt,
      appUrl,
    })
    const sent = await deps.mailer.send({
      to,
      ...message,
      idempotencyKey: dedupeKey,
    })
    if (sent.status === "failed") {
      result.failed += 1
      continue
    }
    result.emailed += 1
    await deps.admin
      .from("notifications")
      .update({ email_sent_at: now.toISOString() })
      .eq("id", notificationId)
      .eq("user_id", row.user_id)
  }
  return result
}
