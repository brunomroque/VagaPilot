import { createHash } from "node:crypto"

import { parseEmailAddress } from "@vagapilot/core/email"

import type { GmailApi } from "./api.js"

/**
 * Verification e-mails sent by an ATS while a run is waiting (OTP codes and confirm/activate
 * links). Read only for an active run, only from that run's ATS domains, only after the step
 * started. The e-mail is untrusted data: nothing in it is followed except a code that appears
 * verbatim in the text, or a link whose final host is on the run's allowlist.
 */

export type VerificationKind = "code" | "link"

export type VerificationMatch = {
  kind: VerificationKind
  /** The code or the resolved link. Never persist nor log it. */
  value: string
  messageId: string
  receivedAt: Date
  via: "regex" | "llm"
}

/** Short-lived, safe to record: proves which e-mail was used without revealing the code. */
export function verificationFingerprint(
  match: VerificationMatch
): Record<string, unknown> {
  return {
    kind: match.kind,
    via: match.via,
    gmail_message_id: match.messageId,
    length: match.value.length,
    host: match.kind === "link" ? safeHost(match.value) : undefined,
  }
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

/** sha256 only for dedupe in memory; never stored (6 digits are brute-forceable). */
export const codeDigest = (code: string) =>
  createHash("sha256").update(code).digest("hex")

const KEYWORD =
  /(c[oó]digo|code|token|otp|pin|senha tempor[aá]ria|verifica\w*|confirma\w*|one[- ]time|seguran[cç]a)/i
const CODE_TOKEN = /\b(?:\d{3}-\d{3}|\d{4,8}|[A-Z0-9]{5,8})\b/g
const NOT_A_CODE = /^(19|20)\d{2}$/ // a year

/**
 * Deterministic OTP extraction: tokens of 4–8 digits (or 5–8 upper alnum with a digit) found
 * within ~80 chars after a keyword ("código", "code", "token"…). Ignores years, phone numbers
 * and amounts. Returns null when there is no single best candidate.
 */
export function extractOtp(text: string): string | null {
  const flat = text.replace(/\r/g, "").replace(/[ \t]+/g, " ")
  const scored = new Map<string, number>()
  for (const match of flat.matchAll(CODE_TOKEN)) {
    const token = match[0]
    const at = match.index ?? 0
    if (NOT_A_CODE.test(token)) continue
    const before = flat.slice(Math.max(0, at - 80), at)
    const around = flat.slice(Math.max(0, at - 3), at + token.length + 3)
    if (/[A-Z]/.test(token) && !(/\d/.test(token) && /[A-Z]/.test(token)))
      continue
    const prev = flat.slice(Math.max(0, at - 3), at)
    const next = flat.slice(at + token.length, at + token.length + 2)
    if (/R\$|\$|\+|\(|[/:#]$/.test(prev) || /^[.,/:@]\w|^\)/.test(next))
      continue // money, phone, url, date
    let score = KEYWORD.test(before) ? 2 : 0
    if (/:\s*$|é\s*$|is\s*$/i.test(before)) score += 1
    if (
      /^\s*$/.test(flat.slice(at + token.length, at + token.length + 2)) &&
      /\n\s*$/.test(before)
    )
      score += 1
    if (score === 0) continue
    scored.set(
      token.replace("-", ""),
      Math.max(scored.get(token.replace("-", "")) ?? 0, score)
    )
  }
  const ranked = [...scored.entries()].sort((a, b) => b[1] - a[1])
  if (!ranked.length) return null
  if (ranked.length > 1 && ranked[0]![1] === ranked[1]![1]) return null
  return ranked[0]![0]
}

/** An LLM answer is accepted only if it is a plausible code that appears verbatim in the e-mail. */
export function acceptLlmCode(
  text: string,
  candidate: string | null | undefined
): string | null {
  const code = candidate?.trim().replace(/\s|-/g, "") ?? ""
  if (!/^[A-Za-z0-9]{4,10}$/.test(code)) return null
  const flat = text.replace(/[\s-]/g, "")
  return flat.includes(code) ? code : null
}

const LINK_WORDS =
  /(confirm|verif|activat|ativ|valid|cadastr|signup|sign-up|register|registr|magic|login|acess|token=|code=)/i
const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi

export function extractLinks(text: string): string[] {
  return [
    ...new Set(
      [...text.matchAll(URL_RE)].map((m) => m[0].replace(/[.,;]+$/, ""))
    ),
  ]
}

/** Is `host` the site or one of its subdomains? */
export function hostMatches(host: string, domain: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "")
  const d = domain.toLowerCase().replace(/^\./, "")
  return h === d || h.endsWith(`.${d}`)
}

export function isAllowedLink(
  url: string,
  allowedDomains: readonly string[]
): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== "https:") return false
    if (parsed.username || parsed.password) return false
    return allowedDomains.some((domain) => hostMatches(parsed.hostname, domain))
  } catch {
    return false
  }
}

/**
 * E-mail click-tracking hosts we may resolve (HEAD, no cookies, no body) to reach the real link.
 * Nothing else outside the run's allowlist is ever requested.
 */
export const TRACKING_HOSTS = [
  "sendgrid.net",
  "list-manage.com",
  "mandrillapp.com",
  "mailgun.org",
  "sparkpostmail.com",
  "mcsv.net",
  "awstrack.me",
  "hubspotlinks.com",
  "safelinks.protection.outlook.com",
  "urldefense.com",
  "rs6.net",
  "mjt.lu",
  "brevo.com",
  "sendibt3.com",
]

export function isTrackingLink(url: string): boolean {
  try {
    const { hostname, protocol } = new URL(url)
    return (
      (protocol === "https:" || protocol === "http:") &&
      TRACKING_HOSTS.some((d) => hostMatches(hostname, d))
    )
  } catch {
    return false
  }
}

/** Wrapped targets that need no request (Google /url?q=, Outlook safelinks ?url=). */
function unwrap(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (
      hostMatches(parsed.hostname, "google.com") &&
      parsed.pathname === "/url"
    )
      return parsed.searchParams.get("q")
    if (hostMatches(parsed.hostname, "safelinks.protection.outlook.com"))
      return parsed.searchParams.get("url")
    if (hostMatches(parsed.hostname, "urldefense.com")) {
      const m = parsed.pathname.match(/__(https?:\/\/.+?)__/)
      return m?.[1] ?? null
    }
  } catch {
    return null
  }
  return null
}

export type ResolveOptions = {
  allowedDomains: readonly string[]
  fetch?: typeof fetch
  maxHops?: number
}

/**
 * Follows tracking redirects hop by hop (redirect: "manual"). Every hop must be a known
 * tracking host or on the allowlist; the final URL must be on the allowlist. Returns null
 * otherwise, so the browser never opens anything outside the run's ATS.
 */
export async function resolveVerificationLink(
  url: string,
  options: ResolveOptions
): Promise<string | null> {
  const doFetch = options.fetch ?? fetch
  let current = url
  for (let hop = 0; hop <= (options.maxHops ?? 5); hop++) {
    if (isAllowedLink(current, options.allowedDomains)) return current
    const unwrapped = unwrap(current)
    if (unwrapped) {
      current = unwrapped
      continue
    }
    if (!isTrackingLink(current)) return null
    let location: string | null = null
    try {
      const response = await doFetch(current, {
        method: "HEAD",
        redirect: "manual",
        credentials: "omit",
      })
      location = response.headers.get("location")
    } catch {
      return null
    }
    if (!location) return null
    current = new URL(location, current).toString()
  }
  return null
}

/** Picks the confirm/activate link of a verification e-mail (resolved and allowlisted). */
export async function extractVerificationLink(
  text: string,
  options: ResolveOptions
): Promise<string | null> {
  const links = extractLinks(text)
  const ranked = [
    ...links.filter((l) => LINK_WORDS.test(l)),
    ...links.filter((l) => !LINK_WORDS.test(l) && isTrackingLink(l)),
  ]
  for (const link of ranked) {
    const resolved = await resolveVerificationLink(link, options)
    if (resolved && LINK_WORDS.test(resolved)) return resolved
  }
  return null
}

export type WaitOptions = {
  kind: VerificationKind
  /** ATS domains of the current run (allowlist for sender and links). */
  domains: readonly string[]
  /** When the verification step started; older e-mails are ignored. */
  since: Date
  timeoutMs?: number
  pollMs?: number
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  fetch?: typeof fetch
  /** Gemini fallback for codes the regex could not pick (answer is re-validated). */
  llmCode?: (text: string) => Promise<string | null>
  /** Codes already used in this run (never reuse an old one). */
  used?: Set<string>
}

export function verificationQuery(
  domains: readonly string[],
  since: Date
): string {
  const from = domains.map((d) => `from:${d}`).join(" OR ")
  // Gmail `after:` has second precision (epoch seconds); keep a 2-minute margin for clock skew.
  const after = Math.floor(since.getTime() / 1000) - 120
  return `(${from}) after:${after}`
}

/**
 * Polls Gmail for a fresh verification e-mail from the run's ATS (default 5 minutes). Only
 * messages whose sender domain matches the allowlist and that arrived after `since` count.
 */
export async function waitForVerification(
  api: GmailApi,
  options: WaitOptions
): Promise<VerificationMatch | null> {
  const now = options.now ?? Date.now
  const sleep =
    options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  const until = now() + (options.timeoutMs ?? 5 * 60_000)
  const seen = new Set<string>()
  const sinceMs = options.since.getTime() - 60_000
  if (!options.domains.length) return null
  while (true) {
    const page = await api.listMessages(
      verificationQuery(options.domains, options.since),
      { maxResults: 10 }
    )
    for (const ref of page.messages) {
      if (seen.has(ref.id)) continue
      seen.add(ref.id)
      const meta = await api.getMetadata(ref.id)
      if (meta.receivedAt.getTime() < sinceMs) continue
      const sender = parseEmailAddress(meta.from)
      if (
        !sender.domain ||
        !options.domains.some((d) => hostMatches(sender.domain!, d))
      )
        continue
      const text = `${meta.subject}\n${await api.getBodyText(ref.id)}`
      if (options.kind === "code") {
        let code = extractOtp(text)
        let via: VerificationMatch["via"] = "regex"
        if (!code && options.llmCode) {
          code = acceptLlmCode(
            text,
            await options.llmCode(text.slice(0, 4000)).catch(() => null)
          )
          via = "llm"
        }
        if (code && !options.used?.has(code)) {
          options.used?.add(code)
          return {
            kind: "code",
            value: code,
            messageId: ref.id,
            receivedAt: meta.receivedAt,
            via,
          }
        }
      } else {
        const link = await extractVerificationLink(text, {
          allowedDomains: options.domains,
          fetch: options.fetch,
        })
        if (link)
          return {
            kind: "link",
            value: link,
            messageId: ref.id,
            receivedAt: meta.receivedAt,
            via: "regex",
          }
      }
    }
    if (now() >= until) return null
    await sleep(options.pollMs ?? 10_000)
  }
}
