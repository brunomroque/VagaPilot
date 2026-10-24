import { findApplyEmail } from "@vagapilot/core/job-text"

import {
  findJsonLdJobPosting,
  htmlToText,
  loadHtml,
  postingFromJsonLd,
} from "../html.js"
import { fetchPublic } from "../http.js"
import { fetchViaProviders } from "../providers.js"
import type { JobSource, JobSourceAdapter, RawJobPosting } from "../types.js"
import { hostMatches, parseUrl } from "../url.js"

const VIEW_PATH = /\/jobs\/view\/(?:[^/]*?-)?(\d{6,})/

function jobId(url: URL): string | null {
  if (!hostMatches(url, "linkedin.com")) return null
  const fromPath = VIEW_PATH.exec(url.pathname)?.[1]
  if (fromPath) return fromPath
  const current = url.searchParams.get("currentJobId")
  return current && /^\d{6,}$/.test(current) ? current : null
}

/** Guest endpoint: public, no login, no cookies (F15 RF15.1, CA4.3). */
export function linkedInGuestUrl(id: string): string {
  return `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${id}`
}

/**
 * The guest page hides the company's own apply link in `<code id="applyUrl"><!--"…"--></code>`
 * as `…/externalApply/{id}?url=<encoded ATS url>` (RF4A.2).
 */
function externalApplyUrl(html: string): string | null {
  const match =
    /<code[^>]*id="applyUrl"[^>]*>\s*<!--\s*"?([^"]+?)"?\s*-->/i.exec(html)
  if (!match?.[1]) return null
  const raw = match[1].replace(/&amp;/g, "&")
  const outer = parseUrl(raw)
  const inner = outer?.searchParams.get("url")
  return inner
    ? (parseUrl(inner)?.toString() ?? null)
    : (outer?.toString() ?? null)
}

function pageTitle($: ReturnType<typeof loadHtml>): string {
  return $(".top-card-layout__title, .topcard__title").first().text().trim()
}

/** "Cargo at Empresa — Cidade | LinkedIn Jobs" (also "na"/"em" in pt-BR pages). */
export function ogTitleParts(raw: string): {
  title: string | null
  company: string | null
  location: string | null
} {
  const clean = raw.replace(/\s*\|\s*LinkedIn.*$/i, "").trim()
  if (!clean) return { title: null, company: null, location: null }
  const [head, location] = clean.split(/\s+[—–-]\s+/, 2)
  const match = /^(.*?)\s+(?:at|na|no|em)\s+(.+)$/.exec(head ?? "")
  return {
    title: (match?.[1] ?? head ?? "").trim() || null,
    company: match?.[2]?.trim() || null,
    location: location?.trim() || null,
  }
}

export type SourceDetector = (url: URL) => JobSource

/** LinkedIn guest page (11.1): one request per link, 24 h cache, 429/999 → blocked. */
export function createLinkedInAdapter(
  detectExternal: SourceDetector
): JobSourceAdapter {
  return {
    source: "linkedin",
    matches(url) {
      return jobId(url) !== null
    },
    canonicalize(url) {
      const id = jobId(url)
      if (!id) throw new Error("Not a LinkedIn job URL")
      return `https://www.linkedin.com/jobs/view/${id}`
    },
    async extract(url, ctx) {
      const id = jobId(url)
      if (!id) return { status: "failed", code: "unsupported" }
      const canonicalUrl = `https://www.linkedin.com/jobs/view/${id}`
      // Guest API first; it is often rate-limited (429) from datacenter IPs, so fall back
      // to the public /jobs/view page (same markup + JSON-LD + og:* tags). QA: a plain
      // linkedin.com/jobs/view link failed to read.
      let fetched = await fetchPublic(ctx, linkedInGuestUrl(id), {
        forbiddenIsBlocked: true,
      })
      let html = fetched.ok ? fetched.response.body : ""
      let $ = loadHtml(html)
      if (!fetched.ok || !pageTitle($)) {
        const page = await fetchPublic(ctx, canonicalUrl, {
          forbiddenIsBlocked: true,
        })
        if (page.ok) {
          fetched = page
          html = page.response.body
          $ = loadHtml(html)
        }
      }
      if (!fetched.ok || !pageTitle($)) {
        // Both direct reads blocked (429/999/authwall/empty): try configured SaaS fetchers.
        const viaProvider = await fetchViaProviders(
          ctx,
          canonicalUrl,
          (body) => {
            const page$ = loadHtml(body)
            return (
              Boolean(
                pageTitle(page$) ||
                findJsonLdJobPosting(page$) ||
                page$('meta[property="og:title"]').attr("content")
              ) && !/authwall|uas\/login/i.test(page$("title").text())
            )
          }
        )
        if (viaProvider) {
          fetched = {
            ok: true,
            response: viaProvider.response,
            fromCache: false,
          }
          html = viaProvider.response.body
          $ = loadHtml(html)
        } else if (!fetched.ok) {
          return fetched.result
        }
      }
      const og = ogTitleParts(
        $('meta[property="og:title"]').attr("content") ?? ""
      )
      const ogDescription =
        $('meta[property="og:description"]').attr("content")?.trim() ?? ""

      const external = externalApplyUrl(html)
      const externalApply =
        external && parseUrl(external)
          ? { url: external, source: detectExternal(parseUrl(external) as URL) }
          : null

      const ld = findJsonLdJobPosting($)
      const fromLd = ld
        ? postingFromJsonLd(ld, {
            source: "linkedin",
            canonicalUrl,
            externalId: id,
          })
        : null

      const title = pageTitle($) || fromLd?.title || og.title || ""
      if (!title) return { status: "failed", code: "parse_error" }
      const descriptionText =
        htmlToText(
          $(".show-more-less-html__markup, .description__text")
            .first()
            .html() ?? ""
        ) ||
        fromLd?.descriptionText ||
        ogDescription
      const criteria = new Map<string, string>()
      $(".description__job-criteria-item").each((_, element) => {
        const key = $(element)
          .find(".description__job-criteria-subheader")
          .text()
          .trim()
          .toLowerCase()
        const value = $(element)
          .find(".description__job-criteria-text")
          .text()
          .trim()
        if (key && value) criteria.set(key, value)
      })
      const employment =
        criteria.get("tipo de emprego") ??
        criteria.get("employment type") ??
        fromLd?.employmentTypeHint ??
        null
      const location =
        $(".topcard__flavor--bullet").first().text().trim() ||
        fromLd?.location ||
        og.location ||
        null
      const workplace = $(".topcard__flavor--metadata, .workplace-type")
        .text()
        .toLowerCase()
      const workModelHint: RawJobPosting["workModelHint"] = /remot/.test(
        workplace
      )
        ? "remoto"
        : /h[ií]brid|hybrid/.test(workplace)
          ? "hibrido"
          : /presencial|on-site|onsite/.test(workplace)
            ? "presencial"
            : (fromLd?.workModelHint ?? null)

      return {
        status: "ok",
        fromCache: fetched.fromCache,
        posting: {
          source: "linkedin",
          canonicalUrl,
          externalId: id,
          title,
          company:
            $(".topcard__org-name-link, .topcard__flavor a")
              .first()
              .text()
              .trim() ||
            fromLd?.company ||
            og.company ||
            null,
          companyDomain: fromLd?.companyDomain ?? null,
          location,
          workModelHint,
          employmentTypeHint: employment,
          descriptionText,
          requirementsHint: null,
          salary: fromLd?.salary ?? null,
          postedAt: fromLd?.postedAt ?? null,
          applyUrl: externalApply?.url ?? canonicalUrl,
          applyEmail: findApplyEmail(descriptionText),
          externalApply,
        },
      }
    },
  }
}
