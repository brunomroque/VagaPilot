import { headers } from "next/headers"

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
  const configured = process.env.NEXT_PUBLIC_APP_URL
  if (configured) return configured.replace(/\/$/, "")

  const headerList = await headers()
  const origin = headerList.get("origin")
  if (origin) return origin
  const host =
    headerList.get("x-forwarded-host") ??
    headerList.get("host") ??
    "127.0.0.1:3000"
  const protocol = headerList.get("x-forwarded-proto") ?? "http"
  return `${protocol}://${host}`
}
