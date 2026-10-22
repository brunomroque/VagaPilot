"use client"

import posthog from "posthog-js"
import { PostHogProvider as PHProvider } from "posthog-js/react"
import { useEffect, type ReactNode } from "react"

const key = process.env.NEXT_PUBLIC_POSTHOG_KEY
const host = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://eu.i.posthog.com"

let posthogInitialized = false

/** Product analytics without PII (spec 12.4 — pseudonymous ids only). */
export function PostHogProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    if (!key || posthogInitialized) return
    posthogInitialized = true
    posthog.init(key, {
      api_host: host,
      person_profiles: "never",
      capture_pageview: true,
      autocapture: false,
      persistence: "localStorage",
      sanitize_properties: (properties) => {
        const out: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(properties)) {
          if (/email|name|phone|cpf|senha|password/i.test(k)) continue
          out[k] = v
        }
        return out
      },
    })
  }, [])

  if (!key) return children
  return <PHProvider client={posthog}>{children}</PHProvider>
}
