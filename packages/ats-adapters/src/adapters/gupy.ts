import { findApplyEmail } from "@vagapilot/core/job-text"

import { htmlToText, loadHtml } from "../html.js"
import type { RawJobPosting } from "../types.js"
import { hostMatches, hostOf } from "../url.js"
import { createHtmlAdapter, type PostingBase } from "./html-sources.js"

const PATH = /^\/jobs\/(\d+)/

type GupyJob = {
  id?: number
  name?: string
  description?: string
  responsibilities?: string
  prerequisites?: string
  relevantExperiences?: string
  workplaceType?: string
  addressCity?: string
  addressState?: string
  publishedDate?: string
  type?: string
  careerPageName?: string
}

function workModel(value: string | undefined): RawJobPosting["workModelHint"] {
  switch (value) {
    case "remote":
      return "remoto"
    case "hybrid":
      return "hibrido"
    case "on-site":
      return "presencial"
    default:
      return null
  }
}

function listItems(html: string | undefined): string[] {
  return htmlToText(html ?? "")
    .split("\n")
    .map((line) => line.replace(/^-\s*/, "").trim())
    .filter((line) => line.length > 1)
}

/** Gupy public page: the job JSON embedded in `__NEXT_DATA__` (RF4.3 (a)). */
function parseNextData(html: string, base: PostingBase): RawJobPosting | null {
  const $ = loadHtml(html)
  const raw = $("script#__NEXT_DATA__").contents().text()
  if (!raw) return null
  let job: GupyJob | undefined
  try {
    job = (JSON.parse(raw) as { props?: { pageProps?: { job?: GupyJob } } })
      .props?.pageProps?.job
  } catch {
    return null
  }
  if (!job?.name) return null
  const required = listItems(job.prerequisites)
  const preferred = listItems(job.relevantExperiences)
  const descriptionText = [
    htmlToText(job.description ?? ""),
    job.responsibilities
      ? `Responsabilidades\n${htmlToText(job.responsibilities)}`
      : "",
    required.length > 0
      ? `Requisitos\n${required.map((item) => `- ${item}`).join("\n")}`
      : "",
    preferred.length > 0
      ? `Diferenciais\n${preferred.map((item) => `- ${item}`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n")
  const location =
    [job.addressCity, job.addressState].filter(Boolean).join(", ") || null
  return {
    ...base,
    externalId: job.id ? String(job.id) : base.externalId,
    title: job.name.trim(),
    company: job.careerPageName?.trim() || null,
    companyDomain: null,
    location,
    workModelHint: workModel(job.workplaceType),
    employmentTypeHint:
      job.type === "vacancy_type_effective"
        ? "CLT (efetivo)"
        : (job.type ?? null),
    descriptionText,
    requirementsHint:
      required.length > 0 || preferred.length > 0
        ? { required, preferred }
        : null,
    salary: null,
    postedAt: job.publishedDate?.slice(0, 10) ?? null,
    applyUrl: base.canonicalUrl,
    applyEmail: findApplyEmail(descriptionText),
    externalApply: null,
  }
}

export const gupyAdapter = createHtmlAdapter({
  source: "gupy",
  matches: (url) => hostMatches(url, "gupy.io") && PATH.test(url.pathname),
  canonicalize: (url) =>
    `https://${hostOf(url)}/jobs/${PATH.exec(url.pathname)?.[1] ?? ""}`,
  externalId: (url) => PATH.exec(url.pathname)?.[1] ?? null,
  parseEmbedded: parseNextData,
})
