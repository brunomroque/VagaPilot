/**
 * Form salary bracket/range options (select, radio, combobox). Pure: no I/O.
 */

export const SALARY_FORM_BLOCK_REASON =
  "Faixas salariais do formulário abaixo da pretensão"

const BRACKET_LABEL =
  /(sal[aá]rio|pretens[aã]o|remunera|faixa\s+salar|compensa[cç][aã]o|expectativa\s+salar)/i

const MONEY =
  /(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*|\d+)(?:\s*,\s*(\d{1,2}))?|\b(\d+(?:[.,]\d+)?)\s*(?:k|mil)\b/gi

/** Parses a BRL amount from a fragment (15001, 15.001, 10k, 10 mil). */
export function parseBrSalaryAmount(text: string): number | null {
  const t = text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
  const shorthand = t.match(/\b(\d+(?:[.,]\d+)?)\s*(?:k|mil)\b/i)
  if (shorthand)
    return Math.round(Number(shorthand[1]!.replace(",", ".")) * 1000)
  const above = t.match(
    /(?:acima|maior\s+que|more\s+than|over)\s*(?:de\s*)?(?:r\$\s*)?(\d{1,3}(?:\.\d{3})*|\d+)/i
  )
  if (above) return parseBrInteger(above[1]!)
  const upTo = t.match(
    /(?:ate|at[eé]|up\s+to|until)\s*(?:r\$\s*)?(\d{1,3}(?:\.\d{3})*|\d+)(?:\s*,\s*(\d{1,2}))?|\b(\d+(?:[.,]\d+)?)\s*(?:k|mil)\b/i
  )
  if (upTo) {
    if (upTo[3]) return Math.round(Number(upTo[3].replace(",", ".")) * 1000)
    return parseBrInteger(upTo[1]!, upTo[2])
  }
  MONEY.lastIndex = 0
  const nums: number[] = []
  let m: RegExpExecArray | null
  while ((m = MONEY.exec(t))) {
    if (m[3]) nums.push(Math.round(Number(m[3].replace(",", ".")) * 1000))
    else nums.push(parseBrInteger(m[1]!, m[2]))
  }
  if (!nums.length) return null
  return nums[0]!
}

function parseBrInteger(intPart: string, decPart?: string | null): number {
  const whole = Number(intPart.replace(/\./g, ""))
  if (!decPart) return whole
  return whole + Number(decPart.padEnd(2, "0").slice(0, 2)) / 100
}

export type ParsedSalaryBracket = {
  min: number | null
  max: number | null
}

/** Parses one option label into a numeric range (BRL). */
export function parseSalaryBracketOption(
  text: string
): ParsedSalaryBracket | null {
  const t = text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
  if (!/\d|k\b|mil\b|r\$/.test(t)) return null
  const shorthand = t.match(/\b(\d+(?:[.,]\d+)?)\s*(?:k|mil)\b/i)
  if (shorthand && !/\ba\b|\bat[eé]\b/.test(t)) {
    const n = Math.round(Number(shorthand[1]!.replace(",", ".")) * 1000)
    return { min: n, max: n }
  }
  const above = t.match(
    /(?:acima|maior\s+que|more\s+than|over)\s*(?:de\s*)?(?:r\$\s*)?(\d{1,3}(?:\.\d{3})*|\d+)/i
  )
  if (above) {
    const min = parseBrInteger(above[1]!)
    return { min, max: null }
  }
  const range = t.match(
    /(?:r\$\s*)?(\d{1,3}(?:\.\d{3})*|\d+)(?:\s*,\s*(\d{1,2}))?\s*(?:a|at[eé]|[-–—])\s*(?:r\$\s*)?(\d{1,3}(?:\.\d{3})*|\d+)(?:\s*,\s*(\d{1,2}))?/i
  )
  if (range) {
    return {
      min: parseBrInteger(range[1]!, range[2]),
      max: parseBrInteger(range[3]!, range[4]),
    }
  }
  const upTo = t.match(/(?:ate|at[eé]|up\s+to|until)\s*(.+)$/i)
  if (upTo) {
    const max = parseBrSalaryAmount(upTo[1]!)
    return max === null ? null : { min: null, max }
  }
  const single = parseBrSalaryAmount(t)
  if (single === null) return null
  return { min: single, max: single }
}

export function isSalaryBracketField(
  label: string,
  options: readonly string[]
): boolean {
  if (!BRACKET_LABEL.test(label)) return false
  if (options.length < 2) return false
  const parsed = options.map((o) => parseSalaryBracketOption(o))
  return parsed.filter(Boolean).length >= 2
}

export type FormSalaryBracketDecision =
  | { action: "pick"; option: string }
  | { action: "pause"; reason: typeof SALARY_FORM_BLOCK_REASON }
  | { action: "none" }

function bracketCoversTarget(
  bracket: ParsedSalaryBracket,
  target: number
): boolean {
  const min = bracket.min ?? 0
  const max = bracket.max ?? Number.POSITIVE_INFINITY
  return min <= target && max >= target
}

function bracketUpper(bracket: ParsedSalaryBracket): number {
  if (bracket.max !== null) return bracket.max
  if (bracket.min !== null) return Number.POSITIVE_INFINITY
  return Number.POSITIVE_INFINITY
}

/**
 * When every parsed option's upper bound is below target ⇒ pause. Otherwise pick the lowest
 * option whose range covers the target.
 */
export function decideFormSalaryBracket(
  options: readonly string[],
  target: number
): FormSalaryBracketDecision {
  const pairs = options
    .map((option) => [option, parseSalaryBracketOption(option)] as const)
    .filter(([, p]) => p !== null) as [string, ParsedSalaryBracket][]
  if (pairs.length < 2) return { action: "none" }
  const uppers = pairs.map(([, p]) => bracketUpper(p))
  if (uppers.every((u) => u !== Number.POSITIVE_INFINITY && u < target))
    return { action: "pause", reason: SALARY_FORM_BLOCK_REASON }
  const covering = pairs
    .filter(([, p]) => bracketCoversTarget(p, target))
    .sort((a, b) => bracketUpper(a[1]) - bracketUpper(b[1]))
  if (!covering.length)
    return { action: "pause", reason: SALARY_FORM_BLOCK_REASON }
  return { action: "pick", option: covering[0]![0] }
}
