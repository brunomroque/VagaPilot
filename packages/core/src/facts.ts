/**
 * Confirmed facts rules (spec F2, 9.3 `confirmed_facts`, 10.1).
 * Only `confirmado` facts may ever reach the agent.
 */

export const FACT_KINDS = [
  "conquista",
  "competencia",
  "ferramenta",
  "certificacao",
  "idioma",
  "dominio",
  "metrica",
] as const
export type FactKind = (typeof FACT_KINDS)[number]

export const FACT_STATUSES = ["proposto", "confirmado", "rejeitado"] as const
export type FactStatus = (typeof FACT_STATUSES)[number]

export const FACT_SOURCES = ["cv_upload", "chat", "manual", "import"] as const
export type FactSource = (typeof FACT_SOURCES)[number]

export const FACT_USAGES = ["cv_relevant", "form_only"] as const
export type FactUsage = (typeof FACT_USAGES)[number]

/** Facts that may appear in CV generation (CHAT-FIRST §5.4). */
export function cvFactsOnly<T extends { usage?: FactUsage | null }>(
  facts: T[]
): T[] {
  return facts.filter((fact) => (fact.usage ?? "cv_relevant") === "cv_relevant")
}

export function buildCvHighlightLines(
  facts: { statement: string; usage?: FactUsage | null }[]
): string[] {
  return cvFactsOnly(facts).map((fact) => `- ${fact.statement.trim()}`)
}

export function isFactKind(value: string): value is FactKind {
  return (FACT_KINDS as readonly string[]).includes(value)
}

/** The only status the agent may use (10.1, CA2.2). */
export function isUsableFact(fact: { status: string }): boolean {
  return fact.status === "confirmado"
}

/**
 * Text normalization for grounding checks: accents, case, quotes, dashes, bullets and
 * whitespace differences between the CV text and the model's excerpt are ignored.
 */
export function normalizeForGrounding(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[‘’´`]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/[•▪◦●·]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/** True when the excerpt appears in the source text after normalization (P1.3). */
export function isExcerptInText(excerpt: string, sourceText: string): boolean {
  const needle = normalizeForGrounding(excerpt)
  if (needle.length < 2) return false
  const haystack = normalizeForGrounding(sourceText)
  // Short excerpts ("Go", "C#") must match a whole token, not part of a word.
  if (needle.length <= 3) {
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(haystack)
  }
  return haystack.includes(needle)
}

function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
}

/** Filler openings the extractor adds; "Possui competência em Kubernetes" = "Kubernetes". */
const FACT_FILLER =
  /^(?:(?:o candidato|candidato|ele|ela|eu)\s+)?(?:possui|tem|tenho|detem|apresenta|demonstra|conta com)?\s*(?:(?:solida|ampla|boa|forte|vasta)\s+)?(?:competencias?|experiencias?|conhecimentos?|dominio|habilidades?|proficiencia|vivencia|nocoes|familiaridade|nivel)?\s*(?:(?:solida|ampla|boa|forte|vasta|avancad[oa]|pratica|tecnica)\s+)?(?:em|com|de|no|na|nos|nas)?\s+/

/**
 * Canonical key for duplicate facts across uploads (QA 02:42): accents, case, punctuation,
 * whitespace and filler openings are ignored, so "Possui inglês avançado", "Inglês Avançado"
 * and "possui ingles avancado" share one key, as do "Kubernetes" and "Possui competência em
 * Kubernetes".
 */
export function factCanonicalKey(statement: string): string {
  let text = fold(statement)
    .replace(/[^a-z0-9+#]+/g, " ")
    .trim()
  for (let i = 0; i < 3; i += 1) {
    const next = (text + " ").replace(FACT_FILLER, "").trim()
    if (!next || next === text) break
    text = next
  }
  return text
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i += 1) {
    let prev = row[0]!
    row[0] = i
    for (let j = 1; j <= b.length; j += 1) {
      const temp = row[j]!
      row[j] = Math.min(
        row[j]! + 1,
        row[j - 1]! + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1)
      )
      prev = temp
    }
  }
  return row[b.length]!
}

/**
 * Returns `name` spelled exactly as it appears in `source` (QA 02:42: the model "corrected"
 * V.tal to "Vital"). Same words ignoring case/accents/punctuation win; otherwise a single
 * source spelling one edit away (names of 4+ letters). Keeps `name` when nothing matches.
 */
export function spellingFromSource(name: string, source: string): string {
  const key = (t: string) => fold(t).replace(/[^a-z0-9]/g, "")
  const target = key(name)
  if (target.length < 2) return name
  const size = Math.max(1, name.trim().split(/\s+/).length)
  const words = [...source.matchAll(/[\p{L}\p{N}]+(?:[.&'’-][\p{L}\p{N}]+)*/gu)]
  const near = new Set<string>()
  for (let w = 1; w <= size + 1; w += 1) {
    for (let i = 0; i + w <= words.length; i += 1) {
      const first = words[i]!
      const last = words[i + w - 1]!
      const text = source.slice(first.index, last.index + last[0].length)
      if (/\n/.test(text)) continue
      const candidate = key(text)
      if (candidate === target) return text
      if (
        target.length >= 4 &&
        Math.abs(candidate.length - target.length) <= 1 &&
        editDistance(candidate, target) === 1
      )
        near.add(text)
    }
  }
  return near.size === 1 ? [...near][0]! : name
}
