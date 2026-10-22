import { greenhouseAdapter } from "./adapters/greenhouse.js"
import { gupyAdapter } from "./adapters/gupy.js"
import {
  genericAdapter,
  inhireAdapter,
  jobbolAdapter,
  quickinAdapter,
  solidesAdapter,
  successFactorsAdapter,
} from "./adapters/html-sources.js"
import { leverAdapter } from "./adapters/lever.js"
import { createLinkedInAdapter } from "./adapters/linkedin.js"
import { workdayAdapter } from "./adapters/workday.js"
import type {
  ExtractResult,
  FetchCtx,
  JobSource,
  JobSourceAdapter,
} from "./types.js"
import { parseUrl } from "./url.js"

const specificAdapters: JobSourceAdapter[] = [
  greenhouseAdapter,
  leverAdapter,
  gupyAdapter,
  inhireAdapter,
  workdayAdapter,
  successFactorsAdapter,
  quickinAdapter,
  jobbolAdapter,
  solidesAdapter,
]

function detectNonLinkedIn(url: URL): JobSource {
  return (
    specificAdapters.find((adapter) => adapter.matches(url))?.source ?? "outro"
  )
}

const linkedInAdapter = createLinkedInAdapter(detectNonLinkedIn)

/** Ordered registry; the generic JSON-LD adapter always matches last (RF4.2). */
export const adapters: readonly JobSourceAdapter[] = [
  linkedInAdapter,
  ...specificAdapters,
  genericAdapter,
]

export function adapterFor(url: URL): JobSourceAdapter {
  return adapters.find((adapter) => adapter.matches(url)) ?? genericAdapter
}

/** Source by URL pattern (RF4.2). Unknown hosts are "outro" (generic adapter). */
export function detectSource(url: string | URL): JobSource {
  const parsed = typeof url === "string" ? parseUrl(url) : url
  return parsed ? adapterFor(parsed).source : "outro"
}

/** Canonical URL used for dedupe between users and the 24 h cache (RF4.5). */
export function canonicalizeUrl(url: string | URL): string | null {
  const parsed = typeof url === "string" ? parseUrl(url) : url
  if (!parsed) return null
  try {
    return adapterFor(parsed).canonicalize(parsed)
  } catch {
    return genericAdapter.canonicalize(parsed)
  }
}

/** Detect → extract. Never receives user credentials (11.1). */
export async function extractJob(
  url: string,
  ctx: FetchCtx
): Promise<ExtractResult> {
  const parsed = parseUrl(url)
  if (!parsed) return { status: "failed", code: "unsupported" }
  return adapterFor(parsed).extract(parsed, ctx)
}
