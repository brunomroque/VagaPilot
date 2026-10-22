import * as Sentry from "@sentry/nextjs"

import { redactSentryEvent } from "@/lib/observability/sentry-redact"

const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0.1"),
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    beforeSend(event) {
      return redactSentryEvent(event)
    },
  })
}
