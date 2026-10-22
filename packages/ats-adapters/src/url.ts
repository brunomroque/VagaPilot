/** URL helpers shared by the adapters. */

const TRACKING_PARAMS = new Set([
  "gclid",
  "fbclid",
  "msclkid",
  "ref",
  "refid",
  "referer",
  "referrer",
  "source",
  "src",
  "trk",
  "trackingid",
  "lipi",
  "origin",
  "gh_src",
  "lever-source",
  "lever-origin",
  "jobboard",
  "mc_cid",
  "mc_eid",
])

export function hostOf(url: URL): string {
  return url.hostname.toLowerCase().replace(/^www\./, "")
}

export function hostMatches(url: URL, suffix: string): boolean {
  const host = hostOf(url)
  return host === suffix || host.endsWith(`.${suffix}`)
}

/**
 * Generic canonical form: https, lowercase host without "www.", no hash, no tracking
 * parameters, remaining parameters sorted, no trailing slash.
 */
export function genericCanonical(
  url: URL,
  keepParams?: readonly string[]
): string {
  const canonical = new URL(url.toString())
  canonical.protocol = "https:"
  canonical.hostname = canonical.hostname.toLowerCase().replace(/^www\./, "")
  canonical.hash = ""
  canonical.port = ""
  const params = [...canonical.searchParams.entries()]
    .filter(([key]) => {
      const lower = key.toLowerCase()
      if (keepParams) return keepParams.includes(lower)
      return !lower.startsWith("utm_") && !TRACKING_PARAMS.has(lower)
    })
    .sort(([a], [b]) => a.localeCompare(b))
  canonical.search = ""
  for (const [key, value] of params) canonical.searchParams.append(key, value)
  const path = canonical.pathname.replace(/\/+$/, "")
  canonical.pathname = path === "" ? "/" : path
  const result = canonical.toString()
  return result.endsWith("/") && canonical.search === ""
    ? result.slice(0, -1)
    : result
}

export function parseUrl(value: string): URL | null {
  try {
    const url = new URL(value.trim())
    return url.protocol === "http:" || url.protocol === "https:" ? url : null
  } catch {
    return null
  }
}

/** "empresa-ficticia" → "Empresa Ficticia" (only a hint; the LLM normalizes the real name). */
export function slugToName(slug: string): string {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}
