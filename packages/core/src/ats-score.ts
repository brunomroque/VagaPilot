/**
 * Deterministic ATS keyword coverage (chat-first spec 4.2, 6 — no LLM).
 */

const STOPWORDS = new Set([
  "com",
  "para",
  "de",
  "da",
  "do",
  "das",
  "dos",
  "em",
  "uma",
  "um",
  "the",
  "and",
  "with",
  "for",
  "ou",
  "e",
  "a",
  "o",
])

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .split(/[^a-z0-9+#.]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length > 2 && !STOPWORDS.has(t))
}

export type AtsBreakdown = {
  score: number
  covered: string[]
  missing: string[]
}

export function computeAtsScore(input: {
  cvText: string
  requirements: readonly string[]
}): AtsBreakdown {
  const reqTokens = new Set<string>()
  for (const req of input.requirements) {
    for (const token of tokens(req)) reqTokens.add(token)
  }
  if (reqTokens.size === 0) {
    return { score: 100, covered: [], missing: [] }
  }
  const cvSet = new Set(tokens(input.cvText))
  const covered: string[] = []
  const missing: string[] = []
  for (const token of reqTokens) {
    if (cvSet.has(token)) covered.push(token)
    else missing.push(token)
  }
  const score = Math.round((covered.length / reqTokens.size) * 100)
  return { score, covered, missing }
}
