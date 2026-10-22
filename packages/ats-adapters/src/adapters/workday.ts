import { findApplyEmail } from "@vagapilot/core/job-text"

import { htmlToText } from "../html.js"
import { fetchPublic, parseJson } from "../http.js"
import type { JobSourceAdapter, RawJobPosting } from "../types.js"
import { hostMatches, hostOf, slugToName } from "../url.js"

const LOCALE = /^[a-z]{2}-[A-Z]{2}$/

type WorkdayJob = {
  jobPostingInfo?: {
    title?: string
    jobDescription?: string
    location?: string
    timeType?: string
    remoteType?: string
    postedOn?: string
    startDate?: string
    jobReqId?: string
    externalUrl?: string
  }
  hiringOrganization?: { name?: string; url?: string }
}

/**
 * `{tenant}.wd{N}.myworkdayjobs.com/{locale?}/{site}/job/{...}` → the public JSON at
 * `/wday/cxs/{tenant}/{site}/job/{...}` (11.1).
 */
function parts(
  url: URL
): { host: string; tenant: string; site: string; jobPath: string } | null {
  if (!hostMatches(url, "myworkdayjobs.com")) return null
  const host = hostOf(url)
  const tenant = host.split(".")[0]
  const segments = url.pathname.split("/").filter(Boolean)
  if (segments[0] && LOCALE.test(segments[0])) segments.shift()
  const site = segments[0]
  const jobIndex = segments.indexOf("job")
  if (!tenant || !site || jobIndex !== 1 || segments.length < 3) return null
  return { host, tenant, site, jobPath: segments.slice(2).join("/") }
}

function workModel(
  remoteType: string | undefined
): RawJobPosting["workModelHint"] {
  const value = (remoteType ?? "").toLowerCase()
  if (/remot/.test(value)) return "remoto"
  if (/h[ií]brid|hybrid/.test(value)) return "hibrido"
  if (/presencial|on.?site/.test(value)) return "presencial"
  return null
}

export const workdayAdapter: JobSourceAdapter = {
  source: "workday",
  matches(url) {
    return parts(url) !== null
  },
  canonicalize(url) {
    const found = parts(url)
    if (!found) throw new Error("Not a Workday job URL")
    return `https://${found.host}/${found.site}/job/${found.jobPath}`
  },
  async extract(url, ctx) {
    const found = parts(url)
    if (!found) return { status: "failed", code: "unsupported" }
    const api = `https://${found.host}/wday/cxs/${found.tenant}/${found.site}/job/${found.jobPath}`
    const fetched = await fetchPublic(ctx, api, { accept: "application/json" })
    if (!fetched.ok) return fetched.result
    const data = parseJson<WorkdayJob>(fetched.response.body)
    const info = data?.jobPostingInfo
    if (!info?.title) return { status: "failed", code: "parse_error" }
    const descriptionText = htmlToText(info.jobDescription ?? "")
    const canonicalUrl = `https://${found.host}/${found.site}/job/${found.jobPath}`
    return {
      status: "ok",
      fromCache: fetched.fromCache,
      posting: {
        source: "workday",
        canonicalUrl,
        externalId: info.jobReqId ?? null,
        title: info.title.trim(),
        company:
          data?.hiringOrganization?.name?.trim() || slugToName(found.tenant),
        companyDomain: null,
        location: info.location?.trim() || null,
        workModelHint: workModel(info.remoteType),
        employmentTypeHint: info.timeType ?? null,
        descriptionText,
        requirementsHint: null,
        salary: null,
        postedAt: info.startDate?.slice(0, 10) ?? null,
        applyUrl: info.externalUrl ?? canonicalUrl,
        applyEmail: findApplyEmail(descriptionText),
        externalApply: null,
      },
    }
  },
}
