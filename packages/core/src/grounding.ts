import { normalizeForGrounding } from "./facts.js"

export type GroundedFact = {
  id: string
  statement: string
}

export type GroundingResult =
  { ok: true } | { ok: false; reason: "missing_facts" | "unsupported_claim" }

/**
 * Ensures free-text answers cite only supplied facts (spec 10.4, F8). Pure: no I/O.
 * When `factIds` is empty, non-empty text is rejected.
 */
export function verifyGrounding(
  text: string,
  factIds: string[],
  facts: GroundedFact[]
): GroundingResult {
  const trimmed = text.trim()
  if (!trimmed) return { ok: true }
  if (factIds.length === 0) return { ok: false, reason: "missing_facts" }

  const byId = new Map(facts.map((fact) => [fact.id, fact.statement]))
  const haystack = normalizeForGrounding(
    factIds
      .map((id) => byId.get(id))
      .filter((statement): statement is string => Boolean(statement))
      .join(" ")
  )
  if (!haystack) return { ok: false, reason: "missing_facts" }

  const needle = normalizeForGrounding(trimmed)
  if (haystack.includes(needle)) return { ok: true }

  const tokens = needle.split(/\s+/).filter((token) => token.length >= 4)
  if (tokens.length === 0) return { ok: false, reason: "unsupported_claim" }
  const supported = tokens.filter((token) => haystack.includes(token))
  if (supported.length / tokens.length >= 0.6) return { ok: true }
  return { ok: false, reason: "unsupported_claim" }
}
