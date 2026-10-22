import { redactPIIText } from "@vagapilot/core/redact"

/** Strip PII from Sentry events before upload (spec 12, logs sem PII). */
export function redactSentryEvent<
  T extends { message?: string; extra?: Record<string, unknown> },
>(event: T): T {
  if (event.message) event.message = redactPIIText(event.message)
  if (event.extra) {
    for (const [key, value] of Object.entries(event.extra)) {
      if (typeof value === "string") event.extra[key] = redactPIIText(value)
    }
  }
  return event
}
