/** Public origin used in auth emails and Stripe return URLs. */

export function nonBlank(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export type AppUrlResolution =
  | { ok: true; url: string }
  | { ok: false; reason: "missing" | "local_in_production" | "invalid" }

/**
 * In production the configured origin must be a public https URL.
 * Localhost stays valid in development. A missing value is `missing` in both
 * environments so dev can fall back to the request origin.
 */
export function resolveAppUrl(input: {
  configured?: string | null
  nodeEnv?: string | null
}): AppUrlResolution {
  const raw = input.configured?.trim().replace(/\/$/, "") ?? ""
  const production = input.nodeEnv === "production"
  if (!raw) return { ok: false, reason: "missing" }
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return { ok: false, reason: "invalid" }
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: "invalid" }
  }
  const local =
    parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1"
  if (production && local) return { ok: false, reason: "local_in_production" }
  if (production && parsed.protocol !== "https:") {
    return { ok: false, reason: "invalid" }
  }
  return { ok: true, url: parsed.origin }
}
