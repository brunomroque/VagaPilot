import * as Sentry from "@sentry/nextjs"

import { redactSentryEvent } from "@/lib/observability/sentry-redact"

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: Number(
      process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? "0.1"
    ),
    beforeSend(event) {
      return redactSentryEvent(event)
    },
  })
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
