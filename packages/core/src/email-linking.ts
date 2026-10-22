/**
 * linkEmailToApplication (P4.2, J5 step 2): rules + similarity on sender domain, normalized
 * company, role, job code and a date window. Pure: no I/O, no LLM.
 */

import {
  domainLabel,
  normalizeCompanyName,
  normalizeDomain,
  trigramSimilarity,
} from "./blocklist.js"
import type { ApplicationStatus } from "./status.js"
import { normalizeSearchText } from "./tracker.js"

export type LinkableApplication = {
  id: string
  company: string
  roleTitle: string
  status: ApplicationStatus
  link: string | null
  appliedAt: string | null
  createdAt: string
  externalProtocol?: string | null
}

export type LinkableEmail = {
  fromName: string | null
  fromDomain: string | null
  subject: string
  /** Snippet or the transient body excerpt used for classification. Never stored here. */
  text: string
  receivedAt: Date
  /** Company and role extracted by the classifier, when present. */
  company?: string | null
  role?: string | null
}

export type LinkCandidate = { applicationId: string; score: number }

export type LinkResult = {
  applicationId: string | null
  score: number
  ambiguous: boolean
  candidates: LinkCandidate[]
}

/** Minimum score to link at all. */
export const LINK_MIN_SCORE = 0.45
/** Below this the link is weak: status changes go to "Revise". */
export const LINK_STRONG_SCORE = 0.6
/** Two candidates closer than this are ambiguous (RF11.3a). */
export const LINK_AMBIGUITY_MARGIN = 0.15
/** E-mails older than the application by more than this are not about it. */
const BEFORE_APPLICATION_TOLERANCE_MS = 2 * 86_400_000
const LONG_AFTER_MS = 180 * 86_400_000

function words(value: string): string {
  return normalizeSearchText(value)
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function containsWords(haystack: string, needle: string): boolean {
  return Boolean(needle) && ` ${haystack} `.includes(` ${needle} `)
}

function hostOf(link: string | null): string {
  return link ? normalizeDomain(link) : ""
}

/** Registrable domain, e.g. `loft.inhire.app` → `inhire.app`. */
function baseDomain(host: string): string {
  const label = domainLabel(host)
  if (!label) return host
  const index = host.indexOf(`${label}.`)
  return index >= 0 ? host.slice(index) : host
}

/** Numeric ids of four or more digits in the posting link (e.g. Greenhouse `/jobs/4567890`). */
function jobCodes(application: LinkableApplication): string[] {
  const codes = new Set<string>()
  for (const match of (application.link ?? "").matchAll(/\d{4,}/g))
    codes.add(match[0])
  const protocol = application.externalProtocol?.trim()
  if (protocol && protocol.length >= 4) codes.add(protocol.toLowerCase())
  return [...codes]
}

function scoreApplication(
  email: LinkableEmail,
  application: LinkableApplication
): number {
  const anchor = Date.parse(application.appliedAt ?? application.createdAt)
  const received = email.receivedAt.getTime()
  if (
    Number.isFinite(anchor) &&
    received < anchor - BEFORE_APPLICATION_TOLERANCE_MS
  )
    return 0

  const company = normalizeCompanyName(application.company)
  if (!company) return 0
  const text = words(`${email.fromName ?? ""} ${email.subject} ${email.text}`)

  // An exact company match is a strong link on its own; a mention in the text needs one more
  // signal (role, job code or ATS domain of the posting).
  let companyScore = 0
  if (email.company) {
    const extracted = normalizeCompanyName(email.company)
    if (extracted === company) companyScore = 0.6
    else if (trigramSimilarity(extracted, company) >= 0.8) companyScore = 0.5
  }
  if (containsWords(text, company)) companyScore = Math.max(companyScore, 0.5)
  const senderLabel = email.fromDomain ? domainLabel(email.fromDomain) : ""
  if (senderLabel && senderLabel === company.replace(/\s+/g, "")) {
    companyScore = Math.max(companyScore, 0.6)
  }

  let score = companyScore
  const appHost = hostOf(application.link)
  if (companyScore > 0 && appHost && email.fromDomain) {
    if (baseDomain(appHost) === baseDomain(normalizeDomain(email.fromDomain)))
      score += 0.1
  }

  const role = words(application.roleTitle)
  if (email.role) {
    const similarity = trigramSimilarity(words(email.role), role)
    if (similarity >= 0.5) score += 0.3 * similarity
  } else if (role && containsWords(text, role)) {
    score += 0.25
  }

  const codes = jobCodes(application)
  if (codes.some((code) => containsWords(text, code))) score += 0.4

  if (Number.isFinite(anchor) && received > anchor + LONG_AFTER_MS) score *= 0.5
  return Math.min(1, Number(score.toFixed(3)))
}

/** Best application for an e-mail, or null. Ambiguous when two candidates score alike. */
export function linkEmailToApplication(
  email: LinkableEmail,
  applications: readonly LinkableApplication[]
): LinkResult {
  const candidates = applications
    .map((application) => ({
      applicationId: application.id,
      score: scoreApplication(email, application),
    }))
    .filter((candidate) => candidate.score >= LINK_MIN_SCORE)
    .sort((a, b) => b.score - a.score)

  const [best, second] = candidates
  if (!best)
    return { applicationId: null, score: 0, ambiguous: false, candidates: [] }
  const ambiguous = Boolean(
    second && best.score - second.score < LINK_AMBIGUITY_MARGIN
  )
  return {
    applicationId: ambiguous ? null : best.applicationId,
    score: best.score,
    ambiguous,
    candidates: candidates.slice(0, 3),
  }
}
