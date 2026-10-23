/**
 * What the Gmail sync may read (F11 RF11.2–RF11.4, RF11.8, 11.2). Pure: no I/O.
 * The search query and the metadata prefilter decide which messages are opened at all;
 * everything else is never fetched beyond its headers.
 */

import {
  domainLabel,
  normalizeCompanyName,
  normalizeDomain,
} from "./blocklist.js"
import { normalizeSearchText } from "./tracker.js"

/** Persisted `email_class` enum (9.2). */
export const EMAIL_CLASSES = [
  "confirmacao",
  "reprovacao",
  "teste_etapa",
  "convite_entrevista",
  "recrutador_contato",
  "vaga_alerta",
  "irrelevante",
] as const

export type EmailClass = (typeof EMAIL_CLASSES)[number]

/**
 * Classifier output (RF11.3). `codigo_verificacao` exists only here: the PDF enum (9.2) has no
 * such value and verification codes are never persisted.
 */
export const CLASSIFIER_CLASSES = [
  ...EMAIL_CLASSES,
  "codigo_verificacao",
  // Finer replies, stored as their closest EMAIL_CLASS (see `storedEmailClass`).
  "em_analise",
  "proposta",
  "documentos",
] as const

/** Classifier-only replies kept in the DB enum as their closest stored class. */
export function storedEmailClass(value: ClassifierClass): EmailClass | null {
  switch (value) {
    case "codigo_verificacao":
      return null
    case "em_analise":
      return "confirmacao"
    case "proposta":
      return "recrutador_contato"
    case "documentos":
      return "teste_etapa"
    default:
      return value
  }
}

export type ClassifierClass = (typeof CLASSIFIER_CLASSES)[number]

export function isEmailClass(value: unknown): value is EmailClass {
  return (
    typeof value === "string" &&
    (EMAIL_CLASSES as readonly string[]).includes(value)
  )
}

/** Known ATS senders named in P4.2. Labels without a TLD match any domain that contains them. */
export const ATS_SENDER_DOMAINS = [
  "gupy.io",
  "inhire.app",
  "greenhouse.io",
  "lever.co",
  "myworkday.com",
  "successfactors",
  "quickin",
  "jobbol",
  "solides",
] as const

/** LinkedIn job alert senders (RF15.2). Read only to turn alerts into batches of links. */
export const JOB_ALERT_SENDERS = [
  "jobalerts-noreply@linkedin.com",
  "jobs-noreply@linkedin.com",
] as const

export const RECRUITING_TERMS_PT = [
  "candidatura",
  "processo seletivo",
  "vaga",
  "entrevista",
  "teste",
  "etapa",
  "recrutamento",
  "seleção",
] as const

export const RECRUITING_TERMS_EN = [
  "application",
  "interview",
  "assessment",
  "recruiter",
  "hiring",
  "candidacy",
] as const

/** First load window (RF11.2). */
export const INITIAL_SYNC_DAYS = 90
/** RF5.2 duplicate search window. */
export const DUPLICATE_SEARCH_DAYS = 365
/** RF11.4: stored excerpt limit. */
export const SNIPPET_MAX_CHARS = 500
/** Companies quoted in the Gmail query; keeps the query short. */
export const MAX_QUERY_COMPANIES = 30

/** Full addresses stay as they are; domains and URLs become bare hosts. */
function senderTerm(value: string): string {
  const trimmed = value.trim().toLowerCase()
  if (/^[^\s@]+@[^\s@]+$/.test(trimmed)) return trimmed
  return normalizeDomain(trimmed) || trimmed
}

function quote(term: string): string {
  const clean = term.replace(/["\\]/g, " ").replace(/\s+/g, " ").trim()
  return /\s/.test(clean) ? `"${clean}"` : clean
}

export type GmailQueryInput = {
  newerThanDays: number
  /** Companies of the user's applications (RF11.2 "nomes de empresas com candidatura"). */
  companies?: readonly string[]
  /** Extra sender domains (company or ATS domains). */
  domains?: readonly string[]
}

/**
 * Gmail search query of RF11.2: known ATS senders, LinkedIn alerts, PT/EN recruiting terms in the
 * subject and the companies the user applied to. Messages outside it are never listed.
 */
export function buildGmailSearchQuery(input: GmailQueryInput): string {
  const senders = [
    ...ATS_SENDER_DOMAINS,
    ...JOB_ALERT_SENDERS,
    ...(input.domains ?? []),
  ]
    .map(senderTerm)
    .filter(Boolean)
  const terms = [...RECRUITING_TERMS_PT, ...RECRUITING_TERMS_EN].map(quote)
  const companies = [
    ...new Set(
      (input.companies ?? [])
        .map((name) => name.trim())
        .filter((name) => name.length > 1)
    ),
  ]
    .slice(0, MAX_QUERY_COMPANIES)
    .map(quote)

  const clauses = [
    `from:(${[...new Set(senders)].join(" OR ")})`,
    `subject:(${terms.join(" OR ")})`,
    ...companies,
  ]
  const days = Math.max(1, Math.round(input.newerThanDays))
  return `newer_than:${days}d (${clauses.join(" OR ")})`
}

export type DuplicateQueryInput = {
  company: string
  role?: string | null
  domains?: readonly string[]
}

/** RF5.2: `from:` ATS/company domains + application terms + company and role, last 12 months. */
export function buildDuplicateSearchQuery(input: DuplicateQueryInput): string {
  const senders = [...ATS_SENDER_DOMAINS, ...(input.domains ?? [])]
    .map(senderTerm)
    .filter(Boolean)
  const mentions = [
    quote(input.company),
    input.role ? quote(input.role) : null,
  ].filter((value): value is string => Boolean(value))
  return [
    `newer_than:${DUPLICATE_SEARCH_DAYS}d`,
    `from:(${[...new Set(senders)].join(" OR ")})`,
    `(candidatura OR application OR ${mentions.join(" OR ")})`,
  ].join(" ")
}

export type EmailAddress = {
  name: string | null
  address: string | null
  domain: string | null
}

/** Parses a `From` header: `Gupy <no-reply@gupy.io>` → name, address and domain. */
export function parseEmailAddress(
  header: string | null | undefined
): EmailAddress {
  const value = (header ?? "").trim()
  if (!value) return { name: null, address: null, domain: null }
  const angle = /^(.*?)<([^<>@\s]+@[^<>\s]+)>\s*$/.exec(value)
  const address = (
    angle?.[2] ??
    /[^\s<>"]+@[^\s<>"]+/.exec(value)?.[0] ??
    ""
  ).toLowerCase()
  const name =
    angle?.[1]
      ?.trim()
      .replace(/^"(.*)"$/, "$1")
      .trim() || null
  const domain = address.includes("@")
    ? normalizeDomain(address.split("@")[1] ?? "")
    : ""
  return { name, address: address || null, domain: domain || null }
}

export function isAtsSenderDomain(domain: string | null | undefined): boolean {
  const host = normalizeDomain(domain ?? "")
  if (!host) return false
  return ATS_SENDER_DOMAINS.some((ats) =>
    ats.includes(".")
      ? host === ats || host.endsWith(`.${ats}`)
      : host.split(".").includes(ats)
  )
}

export function isJobAlertSender(address: string | null | undefined): boolean {
  const value = (address ?? "").toLowerCase()
  return (JOB_ALERT_SENDERS as readonly string[]).includes(value)
}

const VERIFICATION_CODE_SUBJECT =
  /(c[oó]digo|code|token|senha tempor[aá]ria)[^\n]{0,40}(verifica|confirma|acesso|seguran|login|one[- ]time|uso [uú]nico)|(verifica|confirma|acesso|seguran|login)[^\n]{0,30}(c[oó]digo|code)|\b(otp|2fa|one[- ]time (pass)?code)\b/i

/**
 * RF11.8: verification-code e-mails (OTP). Detected on the subject only, so the body is never
 * opened, stored or sent to the LLM. Reading codes needs a separate consent (not in the MVP).
 */
export function looksLikeVerificationCode(
  subject: string | null | undefined
): boolean {
  return VERIFICATION_CODE_SUBJECT.test(subject ?? "")
}

export type PrefilterInput = {
  from: EmailAddress
  subject: string
  /** Company names of the user's applications. */
  companies: readonly string[]
}

export type PrefilterDecision =
  | {
      action: "read"
      reason: "ats_sender" | "job_alert" | "recruiting_term" | "company"
    }
  | { action: "skip"; reason: "verification_code" | "outside_filter" }

function containsWord(haystack: string, needle: string): boolean {
  if (!needle) return false
  return ` ${haystack} `.includes(` ${needle} `)
}

function wordsOf(value: string): string {
  return normalizeSearchText(value)
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

/**
 * Deterministic prefilter (RF11.3, first step) on headers only. Same rules as the search query,
 * so incremental history entries (which ignore the query) follow the same filter.
 */
export function prefilterEmail(input: PrefilterInput): PrefilterDecision {
  if (looksLikeVerificationCode(input.subject)) {
    return { action: "skip", reason: "verification_code" }
  }
  if (isJobAlertSender(input.from.address))
    return { action: "read", reason: "job_alert" }
  if (isAtsSenderDomain(input.from.domain))
    return { action: "read", reason: "ats_sender" }

  const subject = wordsOf(input.subject)
  const terms = [...RECRUITING_TERMS_PT, ...RECRUITING_TERMS_EN].map(wordsOf)
  if (terms.some((term) => containsWord(subject, term))) {
    return { action: "read", reason: "recruiting_term" }
  }

  const sender = wordsOf(`${input.from.name ?? ""} ${input.subject}`)
  const senderLabel = input.from.domain ? domainLabel(input.from.domain) : ""
  for (const company of input.companies) {
    const normalized = normalizeCompanyName(company)
    if (!normalized) continue
    if (
      containsWord(sender, normalized) ||
      senderLabel === normalized.replace(/\s+/g, "")
    ) {
      return { action: "read", reason: "company" }
    }
  }
  return { action: "skip", reason: "outside_filter" }
}

const INJECTION_PATTERNS = [
  /ignor\w* (all |todas )?(as |the )?(previous |prior |anteriores |acima )?(instru|instructions|regras|rules)/,
  /(instru\w*|instructions) (anteriores|previous|acima|above)/,
  /\b(system|sistema|developer)\s*:/,
  /<\/?\s*untrusted/,
  /\b(voce agora e|you are now|aja como|act as)\b/,
  /\bao ler (isto|isso|este e-?mail)/,
  /\b(assistente|assistant|agente|agent|ia|ai)\b\s*[,:]\s*(responda|envie|mude|crie|apague|encaminhe|reply|send|change|create|delete|forward)/,
  /\bcall (send_email|the tool|a tool|tool)/,
  /encaminhe (todos|todas) (os|as) (e-?mails|mensagens)|forward all (emails|messages)/,
]

/**
 * Instructions aimed at the assistant inside an e-mail (RF11.10). Such e-mails never change the
 * tracker automatically, whatever the classifier says. Matching is on folded text.
 */
export function looksLikePromptInjection(text: string): boolean {
  const folded = normalizeSearchText(text)
  return INJECTION_PATTERNS.some((pattern) => pattern.test(folded))
}

/** RF11.4: whitespace-collapsed excerpt of at most 500 characters, cut on a word boundary. */
export function toSnippet(
  text: string | null | undefined,
  max = SNIPPET_MAX_CHARS
): string {
  const clean = (text ?? "").replace(/\s+/g, " ").trim()
  if (clean.length <= max) return clean
  const cut = clean.slice(0, max - 1)
  const lastSpace = cut.lastIndexOf(" ")
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}
