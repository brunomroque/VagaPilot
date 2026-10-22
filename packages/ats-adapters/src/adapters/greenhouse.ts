import { findApplyEmail } from "@vagapilot/core/job-text"

import { decodeEntities, htmlToText } from "../html.js"
import { fetchPublic, parseJson } from "../http.js"
import type { JobSourceAdapter } from "../types.js"
import { hostMatches, slugToName } from "../url.js"

const PATH = /^\/([\w-]+)\/jobs\/(\d+)/

type GreenhouseJob = {
  id?: number
  title?: string
  company_name?: string
  absolute_url?: string
  content?: string
  location?: { name?: string }
  updated_at?: string
  first_published?: string
}

function parts(url: URL): { token: string; id: string } | null {
  if (url.pathname.startsWith("/embed/job_app")) {
    const token = url.searchParams.get("for")
    const id = url.searchParams.get("token")
    return token && id && /^\d+$/.test(id) ? { token, id } : null
  }
  const match = PATH.exec(url.pathname)
  return match?.[1] && match[2] ? { token: match[1], id: match[2] } : null
}

/** Greenhouse Job Board API (11.1): boards-api.greenhouse.io/v1/boards/{token}/jobs/{id}. */
export const greenhouseAdapter: JobSourceAdapter = {
  source: "greenhouse",
  matches(url) {
    return hostMatches(url, "greenhouse.io") && parts(url) !== null
  },
  canonicalize(url) {
    const found = parts(url)
    if (!found) throw new Error("Not a Greenhouse job URL")
    return `https://boards.greenhouse.io/${found.token}/jobs/${found.id}`
  },
  async extract(url, ctx) {
    const found = parts(url)
    if (!found) return { status: "failed", code: "unsupported" }
    const api = `https://boards-api.greenhouse.io/v1/boards/${found.token}/jobs/${found.id}?questions=true`
    const fetched = await fetchPublic(ctx, api, { accept: "application/json" })
    if (!fetched.ok) return fetched.result
    const job = parseJson<GreenhouseJob>(fetched.response.body)
    if (!job?.title) return { status: "failed", code: "parse_error" }
    const descriptionText = htmlToText(decodeEntities(job.content ?? ""))
    const canonicalUrl = `https://boards.greenhouse.io/${found.token}/jobs/${found.id}`
    return {
      status: "ok",
      fromCache: fetched.fromCache,
      posting: {
        source: "greenhouse",
        canonicalUrl,
        externalId: found.id,
        title: job.title.trim(),
        company: job.company_name?.trim() || slugToName(found.token),
        companyDomain: null,
        location: job.location?.name?.trim() || null,
        workModelHint: null,
        employmentTypeHint: null,
        descriptionText,
        requirementsHint: null,
        salary: null,
        postedAt:
          (job.first_published ?? job.updated_at ?? "").slice(0, 10) || null,
        applyUrl: job.absolute_url ?? canonicalUrl,
        applyEmail: findApplyEmail(descriptionText),
        externalApply: null,
      },
    }
  },
}
