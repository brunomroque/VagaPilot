import process from "node:process"

/**
 * Transactional e-mail of the app (Resend, 8.2) — reminders, never the user's Gmail (RF11.6).
 * Without RESEND_API_KEY a logging no-op transport is used (dev); tests inject a mock.
 */

export type MailMessage = {
  to: string
  subject: string
  text: string
  /** Resend idempotency key: the same reminder is never sent twice. */
  idempotencyKey: string
}

export type MailResult = { status: "sent" | "logged" | "failed"; id?: string }

export interface Mailer {
  readonly kind: "resend" | "log"
  send(message: MailMessage): Promise<MailResult>
}

type Env = Readonly<Record<string, string | undefined>>

export const RESEND_API_URL = "https://api.resend.com/emails"

export function createResendMailer(options: {
  apiKey: string
  from: string
  fetch?: typeof fetch
}): Mailer {
  const doFetch = options.fetch ?? fetch
  return {
    kind: "resend",
    async send(message) {
      try {
        const response = await doFetch(RESEND_API_URL, {
          method: "POST",
          headers: {
            authorization: `Bearer ${options.apiKey}`,
            "content-type": "application/json",
            "idempotency-key": message.idempotencyKey,
          },
          body: JSON.stringify({
            from: options.from,
            to: [message.to],
            subject: message.subject,
            text: message.text,
          }),
          signal: AbortSignal.timeout(10_000),
        })
        if (!response.ok) return { status: "failed" }
        const json = (await response.json().catch(() => ({}))) as {
          id?: unknown
        }
        return {
          status: "sent",
          id: typeof json.id === "string" ? json.id : undefined,
        }
      } catch {
        return { status: "failed" }
      }
    },
  }
}

/** Dev transport: logs that a reminder would go out, without the address or the content. */
export function createLogMailer(
  log: (line: string) => void = console.info
): Mailer {
  return {
    kind: "log",
    async send(message) {
      log(
        `[mailer] reminder not sent (RESEND_API_KEY unset): ${message.idempotencyKey}`
      )
      return { status: "logged" }
    },
  }
}

export function createMailerFromEnv(env: Env = process.env): Mailer {
  const apiKey = env.RESEND_API_KEY?.trim()
  if (!apiKey) return createLogMailer()
  return createResendMailer({
    apiKey,
    from: env.EMAIL_FROM?.trim() || "VagaPilot <lembretes@vagapilot.app>",
  })
}
