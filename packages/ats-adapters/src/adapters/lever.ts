import { findApplyEmail } from "@vagapilot/core/job-text"

import { htmlToText } from "../html.js"
import { fetchPublic, parseJson } from "../http.js"
import type { JobSourceAdapter, RawJobPosting } from "../types.js"
import { hostOf, slugToName } from "../url.js"

const PATH = /^\/([\w.-]+)\/([0-9a-f-]{36})(?:\/apply)?\/?$/i

type LeverPosting = {
  id?: string
  text?: string
  categories?: { location?: string; commitment?: string; team?: string }
  workplaceType?: "onsite" | "remote" | "hybrid" | "unspecified"
  descriptionPlain?: string
  description?: string
  lists?: { text?: string; content?: string }[]
  additionalPlain?: string
  hostedUrl?: string
  applyUrl?: string
  createdAt?: number
  salaryRange?: {
    min?: number
    max?: number
    currency?: string
    interval?: string
  }
}

function parts(url: URL): { company: string; id: string; eu: boolean } | null {
  const host = hostOf(url)
  if (host !== "jobs.lever.co" && host !== "jobs.eu.lever.co") return null
  const match = PATH.exec(url.pathname)
  return match?.[1] && match[2]
    ? {
        company: match[1],
        id: match[2].toLowerCase(),
        eu: host === "jobs.eu.lever.co",
      }
    : null
}

const PREFERRED_LIST = /(diferencia|desej|nice|bonus|plus|preferred)/i
const REQUIRED_LIST =
  /(requisit|requirement|qualifica|o que (voc|esper|busc)|what you|must|you have|who you are)/i

function workModel(
  value: LeverPosting["workplaceType"]
): RawJobPosting["workModelHint"] {
  switch (value) {
    case "onsite":
      return "presencial"
    case "remote":
      return "remoto"
    case "hybrid":
      return "hibrido"
    case "unspecified":
    case undefined:
      return null
    default: {
      const unreachable: never = value
      throw new Error(`Unknown Lever workplace type: ${String(unreachable)}`)
    }
  }
}

/** Lever Postings API (11.1): api.lever.co/v0/postings/{company}/{id}. */
export const leverAdapter: JobSourceAdapter = {
  source: "lever",
  matches(url) {
    return parts(url) !== null
  },
  canonicalize(url) {
    const found = parts(url)
    if (!found) throw new Error("Not a Lever job URL")
    return `https://${found.eu ? "jobs.eu.lever.co" : "jobs.lever.co"}/${found.company}/${found.id}`
  },
  async extract(url, ctx) {
    const found = parts(url)
    if (!found) return { status: "failed", code: "unsupported" }
    const api = `https://${found.eu ? "api.eu.lever.co" : "api.lever.co"}/v0/postings/${found.company}/${found.id}`
    const fetched = await fetchPublic(ctx, api, { accept: "application/json" })
    if (!fetched.ok) return fetched.result
    const posting = parseJson<LeverPosting>(fetched.response.body)
    if (!posting?.text) return { status: "failed", code: "parse_error" }

    const required: string[] = []
    const preferred: string[] = []
    const sections: string[] = [
      posting.descriptionPlain ?? htmlToText(posting.description ?? ""),
    ]
    for (const list of posting.lists ?? []) {
      const items = htmlToText(list.content ?? "")
        .split("\n")
        .map((line) => line.replace(/^-\s*/, "").trim())
        .filter(Boolean)
      const heading = list.text?.trim() ?? ""
      sections.push(heading, ...items.map((item) => `- ${item}`))
      if (PREFERRED_LIST.test(heading)) preferred.push(...items)
      else if (REQUIRED_LIST.test(heading)) required.push(...items)
    }
    if (posting.additionalPlain) sections.push(posting.additionalPlain)
    const descriptionText = sections.filter(Boolean).join("\n").trim()
    const salary = posting.salaryRange
    return {
      status: "ok",
      fromCache: fetched.fromCache,
      posting: {
        source: "lever",
        canonicalUrl: `https://${found.eu ? "jobs.eu.lever.co" : "jobs.lever.co"}/${found.company}/${found.id}`,
        externalId: found.id,
        title: posting.text.trim(),
        company: slugToName(found.company),
        companyDomain: null,
        location: posting.categories?.location?.trim() || null,
        workModelHint: workModel(posting.workplaceType),
        employmentTypeHint: posting.categories?.commitment ?? null,
        descriptionText,
        requirementsHint:
          required.length > 0 || preferred.length > 0
            ? { required, preferred }
            : null,
        salary: salary
          ? {
              min: salary.min ?? null,
              max: salary.max ?? null,
              currency: salary.currency ?? null,
              period: salary.interval ?? null,
            }
          : null,
        postedAt: posting.createdAt
          ? new Date(posting.createdAt).toISOString().slice(0, 10)
          : null,
        applyUrl: posting.applyUrl ?? posting.hostedUrl ?? null,
        applyEmail: findApplyEmail(descriptionText),
        externalApply: null,
      },
    }
  },
}
