/**
 * Company blocklist matching (spec F1 RF1.5, CA1.4, prompt P1.1).
 * Pure functions: normalization, domain comparison and trigram similarity (pg_trgm style).
 */

export const BLOCKLIST_SIMILARITY_THRESHOLD = 0.9

/** Legal and generic suffixes removed before comparing names (P1.1 list plus common legal forms). */
const STOP_TOKENS: ReadonlySet<string> = new Set([
  "ltda",
  "ltd",
  "sa",
  "brasil",
  "brazil",
  "group",
  "grupo",
  "tecnologia",
  "tecnologias",
  "eireli",
  "me",
  "epp",
  "inc",
  "llc",
])

/** Two-level public suffixes common for Brazilian and international companies. */
const SECOND_LEVEL_SUFFIXES: ReadonlySet<string> = new Set([
  "com.br",
  "net.br",
  "org.br",
  "gov.br",
  "edu.br",
  "ind.br",
  "co.uk",
  "com.ar",
  "com.mx",
  "co.jp",
  "com.au",
])

function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "")
}

/**
 * Lowercase, accent-free, punctuation-free company name without legal suffixes.
 * "ACME Ltda." → "acme"; "Acme Brasil S/A" → "acme".
 */
export function normalizeCompanyName(name: string): string {
  const base = stripAccents(name)
    .toLowerCase()
    .replace(/&/g, " e ")
    // "S/A", "S.A." and "S. A." become the token "sa".
    .replace(/\bs\s*[./]\s*a\b\.?/g, " sa ")
    .replace(/[^a-z0-9]+/g, " ")
    // "Siemens do Brasil" → "Siemens".
    .replace(/\b(do|da|de) (brasil|brazil)\b/g, " ")
    .trim()
  const tokens = base.split(/\s+/).filter(Boolean)
  const kept = tokens.filter((token) => !STOP_TOKENS.has(token))
  // Never normalize a name to nothing ("Grupo Brasil" stays comparable).
  return (kept.length > 0 ? kept : tokens).join(" ")
}

/** Host without protocol, `www.`, port or path. Returns "" when nothing host-like is present. */
export function normalizeDomain(input: string): string {
  const trimmed = input.trim().toLowerCase()
  if (!trimmed) return ""
  let host = trimmed
  try {
    host = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`)
      .hostname
  } catch {
    host = trimmed.split(/[/?#:]/)[0] ?? ""
  }
  return host.replace(/^www\./, "").replace(/\.$/, "")
}

/** "careers.acme.com.br" → "acme"; "acme.io" → "acme". */
export function domainLabel(domain: string): string {
  const host = normalizeDomain(domain)
  const parts = host.split(".").filter(Boolean)
  if (parts.length < 2) return parts[0] ?? ""
  const lastTwo = parts.slice(-2).join(".")
  const suffixLength = SECOND_LEVEL_SUFFIXES.has(lastTwo) ? 2 : 1
  return parts[parts.length - suffixLength - 1] ?? ""
}

function trigrams(value: string): Set<string> {
  const result = new Set<string>()
  for (const word of value.split(/\s+/).filter(Boolean)) {
    const padded = `  ${word} `
    for (let index = 0; index + 3 <= padded.length; index += 1) {
      result.add(padded.slice(index, index + 3))
    }
  }
  return result
}

/** Jaccard similarity over word trigrams, like PostgreSQL pg_trgm `similarity()`. */
export function trigramSimilarity(a: string, b: string): number {
  const left = trigrams(a)
  const right = trigrams(b)
  if (left.size === 0 && right.size === 0) return a === b ? 1 : 0
  let shared = 0
  for (const gram of left) if (right.has(gram)) shared += 1
  return shared / (left.size + right.size - shared)
}

export type BlocklistEntry = {
  id?: string
  companyName: string
  /** Stored `normalized_name`; recomputed from `companyName` when absent. */
  normalizedName?: string
  aliases?: readonly string[]
  domains?: readonly string[]
}

export type BlocklistCandidate = {
  company?: string | null
  /** Company domain, job URL or e-mail domain. */
  domain?: string | null
}

export type BlocklistMatchReason = "name" | "alias" | "domain" | "similar"

export type BlocklistMatch<E extends BlocklistEntry = BlocklistEntry> = {
  entry: E
  reason: BlocklistMatchReason
  similarity: number
}

function domainMatches(candidate: string, blocked: string): boolean {
  return candidate === blocked || candidate.endsWith(`.${blocked}`)
}

/**
 * First blocklist entry that matches the candidate, or null.
 * Matches by exact normalized name, alias, domain (including subdomains and the
 * domain label against the name) and trigram similarity ≥ 0.9.
 */
export function matchBlocklist<E extends BlocklistEntry>(
  entries: readonly E[],
  candidate: BlocklistCandidate,
  threshold: number = BLOCKLIST_SIMILARITY_THRESHOLD
): BlocklistMatch<E> | null {
  const name = candidate.company ? normalizeCompanyName(candidate.company) : ""
  const domain = candidate.domain ? normalizeDomain(candidate.domain) : ""
  const label = domain ? domainLabel(domain) : ""

  let best: BlocklistMatch<E> | null = null

  for (const entry of entries) {
    const entryName =
      entry.normalizedName || normalizeCompanyName(entry.companyName)
    const aliases = (entry.aliases ?? [])
      .map(normalizeCompanyName)
      .filter(Boolean)

    if (name && name === entryName) {
      return { entry, reason: "name", similarity: 1 }
    }
    if (name && aliases.includes(name)) {
      return { entry, reason: "alias", similarity: 1 }
    }
    if (domain) {
      const blockedDomains = (entry.domains ?? [])
        .map(normalizeDomain)
        .filter(Boolean)
      if (blockedDomains.some((blocked) => domainMatches(domain, blocked))) {
        return { entry, reason: "domain", similarity: 1 }
      }
      if (
        label &&
        [entryName, ...aliases].some((n) => n.replace(/\s+/g, "") === label)
      ) {
        return { entry, reason: "domain", similarity: 1 }
      }
    }
    if (name) {
      for (const reference of [entryName, ...aliases]) {
        const similarity = trigramSimilarity(name, reference)
        if (similarity >= threshold && similarity > (best?.similarity ?? 0)) {
          best = { entry, reason: "similar", similarity }
        }
      }
    }
  }

  return best
}
