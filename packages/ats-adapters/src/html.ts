import { findApplyEmail } from "@vagapilot/core/job-text"
import * as cheerio from "cheerio"

import type { JobSource, RawJobPosting } from "./types.js"

type CheerioRoot = ReturnType<typeof cheerio.load>

export function loadHtml(html: string): CheerioRoot {
  return cheerio.load(html)
}

const BLOCK_TAGS =
  "p, div, section, article, br, h1, h2, h3, h4, h5, h6, ul, ol, tr, header, footer"

/** HTML → plain text with line breaks per block and "- " for list items. */
export function htmlToText(html: string): string {
  if (!html.trim()) return ""
  const $ = cheerio.load(`<div id="vp-root">${html}</div>`)
  $("script, style, noscript, template, iframe, svg").remove()
  $('[hidden], [aria-hidden="true"], .sr-only, .visually-hidden').remove()
  $("[style]").each((_, element) => {
    const style = ($(element).attr("style") ?? "")
      .replace(/\s+/g, "")
      .toLowerCase()
    if (/display:none|visibility:hidden|font-size:0|opacity:0/.test(style))
      $(element).remove()
  })
  $("li").each((_, element) => {
    $(element).prepend("\n- ").append("\n")
  })
  $(BLOCK_TAGS).each((_, element) => {
    $(element).before("\n").after("\n")
  })
  return $("#vp-root")
    .text()
    .split("\n")
    .map((line) => line.replace(/[ \t\u00a0]+/g, " ").trim())
    .filter(
      (line, index, lines) =>
        line !== "" || (index > 0 && lines[index - 1] !== "")
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/** Decodes HTML entities in an escaped HTML string (Greenhouse `content`). */
export function decodeEntities(value: string): string {
  return cheerio.load(`<textarea>${value}</textarea>`)("textarea").text()
}

type JsonLdNode = Record<string, unknown>

function asArray(value: unknown): unknown[] {
  return Array.isArray(value)
    ? value
    : value === undefined || value === null
      ? []
      : [value]
}

function hasType(node: JsonLdNode, type: string): boolean {
  return asArray(node["@type"]).some((entry) => entry === type)
}

function collectNodes(value: unknown, out: JsonLdNode[]): void {
  for (const item of asArray(value)) {
    if (!item || typeof item !== "object") continue
    const node = item as JsonLdNode
    out.push(node)
    if (node["@graph"]) collectNodes(node["@graph"], out)
  }
}

/** First schema.org/JobPosting found in the page's JSON-LD blocks, or null. */
export function findJsonLdJobPosting($: CheerioRoot): JsonLdNode | null {
  const nodes: JsonLdNode[] = []
  $('script[type="application/ld+json"]').each((_, element) => {
    const raw = $(element).contents().text().trim()
    if (!raw) return
    try {
      collectNodes(JSON.parse(raw), nodes)
    } catch {
      // Malformed JSON-LD is common; the cheerio fallback handles the page.
    }
  })
  return nodes.find((node) => hasType(node, "JobPosting")) ?? null
}

function text(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null
  if (typeof value === "number") return String(value)
  return null
}

function field(node: unknown, key: string): unknown {
  return node && typeof node === "object"
    ? (node as JsonLdNode)[key]
    : undefined
}

function hostOf(value: string | null): string | null {
  if (!value) return null
  try {
    return new URL(value).hostname.replace(/^www\./, "")
  } catch {
    return null
  }
}

function locationOf(ld: JsonLdNode): string | null {
  const parts: string[] = []
  for (const place of asArray(ld.jobLocation)) {
    const address = field(place, "address")
    const pieces = [
      text(field(address, "addressLocality")),
      text(field(address, "addressRegion")),
    ].filter((piece): piece is string => Boolean(piece))
    const label =
      pieces.length > 0 ? pieces.join(", ") : text(field(place, "name"))
    if (label && !parts.includes(label)) parts.push(label)
  }
  return parts.length > 0 ? parts.join(" / ") : null
}

function salaryOf(ld: JsonLdNode): RawJobPosting["salary"] {
  const base = ld.baseSalary
  if (!base || typeof base !== "object") return null
  const value = field(base, "value")
  const number = (input: unknown) => {
    const parsed = typeof input === "string" ? Number(input) : input
    return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null
  }
  const min =
    number(field(value, "minValue")) ??
    number(field(value, "value")) ??
    number(value)
  const max = number(field(value, "maxValue")) ?? min
  if (min === null && max === null) return null
  return {
    min,
    max,
    currency: text(field(base, "currency")),
    period: text(field(value, "unitText")),
  }
}

function dateOnly(value: unknown): string | null {
  const raw = text(value)
  if (!raw) return null
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(raw)
  if (match?.[1]) return match[1]
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime())
    ? null
    : parsed.toISOString().slice(0, 10)
}

/** Maps a JSON-LD JobPosting into the raw posting shape. */
export function postingFromJsonLd(
  ld: JsonLdNode,
  base: { source: JobSource; canonicalUrl: string; externalId: string | null }
): RawJobPosting | null {
  const title = text(ld.title)
  if (!title) return null
  const organization = ld.hiringOrganization
  const organizationUrl =
    text(field(organization, "sameAs")) ?? text(field(organization, "url"))
  const descriptionText = htmlToText(text(ld.description) ?? "")
  const locationType = asArray(ld.jobLocationType).map((entry) =>
    String(entry).toUpperCase()
  )
  const identifier = ld.identifier
  return {
    source: base.source,
    canonicalUrl: base.canonicalUrl,
    externalId:
      base.externalId ?? text(field(identifier, "value")) ?? text(identifier),
    title,
    company: text(field(organization, "name")) ?? text(organization),
    companyDomain: hostOf(organizationUrl),
    location: locationOf(ld),
    workModelHint: locationType.includes("TELECOMMUTE") ? "remoto" : null,
    employmentTypeHint:
      asArray(ld.employmentType).map(String).join(", ") || null,
    descriptionText,
    requirementsHint: null,
    salary: salaryOf(ld),
    postedAt: dateOnly(ld.datePosted),
    applyUrl: text(ld.url) ?? base.canonicalUrl,
    applyEmail: findApplyEmail(descriptionText),
    externalApply: null,
  }
}

/** Last resort for pages without JSON-LD: title, company and main text by common markup. */
export function postingFromPage(
  $: CheerioRoot,
  base: { source: JobSource; canonicalUrl: string; externalId: string | null }
): RawJobPosting | null {
  const title =
    $("h1").first().text().trim() ||
    $('meta[property="og:title"]').attr("content")?.trim() ||
    $("title").text().trim()
  if (!title) return null
  const company =
    $('meta[property="og:site_name"]').attr("content")?.trim() ||
    $(
      '[itemprop="hiringOrganization"], .company, .company-name, [data-company]'
    )
      .first()
      .text()
      .trim() ||
    null
  const main = $(
    "main, article, [role=main], .job-description, #job-description"
  ).first()
  const descriptionText = htmlToText(
    (main.length > 0 ? main : $("body")).html() ?? ""
  )
  return {
    source: base.source,
    canonicalUrl: base.canonicalUrl,
    externalId: base.externalId,
    title,
    company,
    companyDomain: null,
    location:
      $('[itemprop="jobLocation"], .location, .job-location')
        .first()
        .text()
        .trim() || null,
    workModelHint: null,
    employmentTypeHint: null,
    descriptionText,
    requirementsHint: null,
    salary: null,
    postedAt: null,
    applyUrl: base.canonicalUrl,
    applyEmail: findApplyEmail(descriptionText),
    externalApply: null,
  }
}
