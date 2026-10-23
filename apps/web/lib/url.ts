import { headers } from "next/headers"

import { resolveAppUrl } from "@vagapilot/core/app-url"

/** Only same-site relative paths are accepted as post-login destinations (no open redirects). */
export function safeNextPath(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.startsWith("/\\")
  )
    return fallback
  return value
}

export async function getAppOrigin(): Promise<string> {
  const resolved = resolveAppUrl({
    configured: process.env.NEXT_PUBLIC_APP_URL,
    nodeEnv: process.env.NODE_ENV,
  })
  if (resolved.ok) return resolved.url
  if (process.env.NODE_ENV === "production") {
    throw new Error(`public_app_url:${resolved.reason}`)
  }

  const headerList = await headers()
  const origin = headerList.get("origin")
  if (origin) return origin.replace(/\/$/, "")
  const host =
    headerList.get("x-forwarded-host") ??
    headerList.get("host") ??
    "127.0.0.1:3100"
  const protocol = headerList.get("x-forwarded-proto") ?? "http"
  return `${protocol}://${host}`
}

/** Stripe return URLs. Production refuses a missing or localhost public origin. */
export function billingAppUrl(): string {
  const resolved = resolveAppUrl({
    configured: process.env.NEXT_PUBLIC_APP_URL,
    nodeEnv: process.env.NODE_ENV,
  })
  if (resolved.ok) return resolved.url
  if (process.env.NODE_ENV === "production") {
    throw new Error(`public_app_url:${resolved.reason}`)
  }
  return "http://localhost:3100"
}
