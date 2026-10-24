import {
  findJsonLdJobPosting,
  loadHtml,
  postingFromJsonLd,
  postingFromPage,
} from "../html.js"
import { fetchPublic } from "../http.js"
import { fetchViaProviders } from "../providers.js"
import type {
  ExtractResult,
  FetchCtx,
  JobSource,
  JobSourceAdapter,
  RawJobPosting,
} from "../types.js"
import { genericCanonical, hostMatches, hostOf, parseUrl } from "../url.js"

type HtmlAdapterConfig = {
  source: JobSource
  matches: (url: URL) => boolean
  canonicalize: (url: URL) => string
  externalId?: (url: URL) => string | null
  /** Source-specific parsing tried before JSON-LD (e.g. Gupy's embedded JSON). */
  parseEmbedded?: (html: string, base: PostingBase) => RawJobPosting | null
}

export type PostingBase = {
  source: JobSource
  canonicalUrl: string
  externalId: string | null
}

/** Hosts of known ATSs, used to spot "vaga externa" links on generic pages (RF4A.2). */
const ATS_LINK_HOSTS: readonly [string, JobSource][] = [
  ["greenhouse.io", "greenhouse"],
  ["lever.co", "lever"],
  ["myworkdayjobs.com", "workday"],
  ["gupy.io", "gupy"],
  ["inhire.app", "inhire"],
  ["successfactors.com", "successfactors"],
  ["successfactors.eu", "successfactors"],
  ["quickin.io", "quickin"],
  ["jobbol.com.br", "jobbol"],
  ["solides.com.br", "solides"],
]

function findExternalApply(
  html: string,
  pageUrl: URL
): RawJobPosting["externalApply"] {
  const $ = loadHtml(html)
  let found: RawJobPosting["externalApply"] = null
  $("a[href]").each((_, element) => {
    if (found) return
    const href = $(element).attr("href") ?? ""
    let absolute: string
    try {
      absolute = new URL(href, pageUrl).toString()
    } catch {
      return
    }
    const target = parseUrl(absolute)
    if (!target || hostOf(target) === hostOf(pageUrl)) return
    const label = $(element).text().toLowerCase()
    if (!/(candidat|aplicar|inscrev|apply)/.test(label)) return
    const ats = ATS_LINK_HOSTS.find(([host]) => hostMatches(target, host))
    if (ats) found = { url: target.toString(), source: ats[1] }
  })
  return found
}

/** HTML + schema.org/JobPosting (JSON-LD) with a cheerio fallback (11.1 order (c)). */
export function createHtmlAdapter(config: HtmlAdapterConfig): JobSourceAdapter {
  return {
    source: config.source,
    matches: config.matches,
    canonicalize: config.canonicalize,
    async extract(url: URL, ctx: FetchCtx): Promise<ExtractResult> {
      const canonicalUrl = config.canonicalize(url)
      const base: PostingBase = {
        source: config.source,
        canonicalUrl,
        externalId: config.externalId?.(url) ?? null,
      }
      const parse = (body: string) => {
        const $ = loadHtml(body)
        const ld = findJsonLdJobPosting($)
        const parsed =
          config.parseEmbedded?.(body, base) ??
          (ld ? postingFromJsonLd(ld, base) : null) ??
          postingFromPage($, base)
        return parsed?.title ? parsed : null
      }
      let fetched = await fetchPublic(ctx, canonicalUrl)
      let posting = fetched.ok ? parse(fetched.response.body) : null
      const retryable =
        !fetched.ok &&
        !(
          fetched.result.status === "failed" &&
          fetched.result.code === "not_found"
        )
      if (!posting && (fetched.ok || retryable)) {
        // Blocked (429/403), timed out or an empty/JS-only page: try configured SaaS fetchers.
        const via = await fetchViaProviders(ctx, canonicalUrl, (body) =>
          Boolean(parse(body))
        )
        if (via) {
          fetched = { ok: true, response: via.response, fromCache: false }
          posting = parse(via.response.body)
        }
      }
      if (!fetched.ok) return fetched.result
      const html = fetched.response.body
      if (!posting) return { status: "failed", code: "parse_error" }
      return {
        status: "ok",
        fromCache: fetched.fromCache,
        posting: {
          ...posting,
          externalApply: posting.externalApply ?? findExternalApply(html, url),
        },
      }
    },
  }
}

function pathId(pattern: RegExp) {
  return (url: URL) => pattern.exec(url.pathname)?.[1] ?? null
}

export const inhireAdapter = createHtmlAdapter({
  source: "inhire",
  matches: (url) =>
    hostMatches(url, "inhire.app") && /^\/vagas\/[\w-]+/.test(url.pathname),
  canonicalize: (url) => {
    const id = /^\/vagas\/([\w-]+)/.exec(url.pathname)?.[1]
    return `https://${hostOf(url)}/vagas/${id ?? ""}`
  },
  externalId: pathId(/^\/vagas\/([\w-]+)/),
})

export const successFactorsAdapter = createHtmlAdapter({
  source: "successfactors",
  matches: (url) =>
    (/^career\d*\./.test(hostOf(url)) &&
      (hostMatches(url, "successfactors.com") ||
        hostMatches(url, "successfactors.eu"))) ||
    hostOf(url) === "jobs.sap.com",
  canonicalize: (url) =>
    hostOf(url) === "jobs.sap.com"
      ? genericCanonical(url, [])
      : genericCanonical(url, ["company", "career_job_req_id", "career_ns"]),
  externalId: (url) =>
    url.searchParams.get("career_job_req_id") ??
    /\/(\d+)\/?$/.exec(url.pathname)?.[1] ??
    null,
})

export const quickinAdapter = createHtmlAdapter({
  source: "quickin",
  matches: (url) => hostMatches(url, "quickin.io"),
  canonicalize: (url) => genericCanonical(url, []),
  externalId: pathId(/\/jobs\/([\w-]+)/),
})

export const jobbolAdapter = createHtmlAdapter({
  source: "jobbol",
  matches: (url) => hostMatches(url, "jobbol.com.br"),
  canonicalize: (url) => genericCanonical(url, []),
  externalId: pathId(/-(\d+)\/?$/),
})

export const solidesAdapter = createHtmlAdapter({
  source: "solides",
  matches: (url) =>
    hostMatches(url, "solides.com.br") && /\/vaga\//.test(url.pathname),
  canonicalize: (url) => genericCanonical(url, []),
  externalId: pathId(/\/vaga\/([\w-]+)/),
})

/** Any other page with JSON-LD JobPosting (Kenoby, Recrutei, company career sites...). */
export const genericAdapter = createHtmlAdapter({
  source: "outro",
  matches: () => true,
  canonicalize: (url) => genericCanonical(url),
})
