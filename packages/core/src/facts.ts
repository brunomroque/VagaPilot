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
