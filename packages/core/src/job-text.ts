/**
 * Plain-text helpers for job descriptions (spec F4 RF4.4, P2.2). Pure: no I/O.
 * Used by the adapters (requirement hints) and by the deterministic extraction fallback.
 */

export type TextLanguage = "pt-BR" | "en" | "es"

function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
}

const REQUIRED_HEADINGS: readonly RegExp[] = [
  /^requisitos( obrigatorios| tecnicos| e qualificacoes)?$/,
  /^pre-?requisitos$/,
  /^qualificacoes( necessarias| obrigatorias)?$/,
  /^requirements$/,
  /^qualifications$/,
  /^(minimum|basic|required) qualifications$/,
  /^must[- ]haves?$/,
  /^o que (voce precisa|esperamos|buscamos|procuramos)( de voce)?$/,
  /^voce (precisa|deve) ter$/,
  /^what (you'?ll|you will) need$/,
  /^what we'?re looking for$/,
  /^who you are$/,
  /^requisitos e qualificacoes$/,
]

const PREFERRED_HEADINGS: readonly RegExp[] = [
  /^diferenciais$/,
  /^desejaveis?$/,
  /^requisitos desejaveis$/,
  /^sera um diferencial$/,
  /^pontos extras$/,
  /^nice[- ]to[- ]haves?$/,
  /^bonus( points)?$/,
  /^preferred( qualifications)?$/,
  /^plus$/,
]

const OTHER_HEADINGS: readonly RegExp[] = [
  /^responsabilidades( e atribuicoes)?$/,
  /^atribuicoes$/,
  /^atividades$/,
  /^sobre( a vaga| nos| a empresa| o time)?$/,
  /^about( us| the role| the job| the team)?$/,
  /^beneficios$/,
  /^benefits$/,
  /^responsibilities$/,
  /^what (you'?ll|you will) do$/,
  /^o que voce (vai|ira) fazer$/,
  /^informacoes adicionais$/,
  /^additional information$/,
  /^local( de trabalho)?$/,
  /^etapas( do processo)?$/,
  /^como (se candidatar|aplicar)$/,
  /^descricao( da vaga)?$/,
  /^job description$/,
  /^remuneracao$/,
  /^compensation$/,
]

const BULLET = /^\s*(?:[-•*▪◦●·]|\d{1,2}[.)])\s+/

function headingKey(line: string): string {
  return fold(line)
    .replace(/[’`]/g, "'")
    .replace(/[:.!]+$/, "")
    .replace(/\s+/g, " ")
    .trim()
}

type HeadingKind = "required" | "preferred" | "other"

function headingKind(line: string): HeadingKind | null {
  if (line.length > 70 || BULLET.test(line)) return null
  const key = headingKey(line)
  if (REQUIRED_HEADINGS.some((re) => re.test(key))) return "required"
  if (PREFERRED_HEADINGS.some((re) => re.test(key))) return "preferred"
  if (OTHER_HEADINGS.some((re) => re.test(key))) return "other"
  return null
}

const MAX_ITEMS = 25

function cleanItem(line: string): string {
  return line
    .replace(BULLET, "")
    .replace(/\s+/g, " ")
    .replace(/[;.]$/, "")
    .trim()
}

/**
 * Splits a job description into required and preferred requirement lists using the
 * section headings common in PT and EN postings ("Requisitos", "Diferenciais", ...).
 */
export function splitRequirementSections(text: string): {
  required: string[]
  preferred: string[]
} {
  const required: string[] = []
  const preferred: string[] = []
  let current: HeadingKind | null = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const kind = headingKind(line)
    if (kind) {
      current = kind
      continue
    }
    const item = cleanItem(line)
    if (item.length < 2 || item.length > 300) continue
    if (current === "required" && required.length < MAX_ITEMS)
      required.push(item)
    if (current === "preferred" && preferred.length < MAX_ITEMS)
      preferred.push(item)
  }
  return { required, preferred }
}

const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi
const APPLY_HINT =
  /(envie|enviar|encaminhe|mande|send|e-?mail|curr[ií]culo|\bcv\b|candidat|apply)/i

/** E-mail the posting asks candidates to write to ("envie seu CV para ..."), or null. */
export function findApplyEmail(text: string): string | null {
  const lines = text.split(/\r?\n/)
  let fallback: string | null = null
  for (const line of lines) {
    const matches = line.match(EMAIL)
    if (!matches) continue
    const email = matches[0]?.toLowerCase() ?? null
    if (email && APPLY_HINT.test(line)) return email
    fallback ??= email
  }
  return fallback
}

const STOPWORDS: Record<TextLanguage, readonly string[]> = {
  "pt-BR": [
    "voce",
    "para",
    "com",
    "uma",
    "nao",
    "experiencia",
    "sera",
    "nosso",
    "vaga",
    "requisitos",
    "e",
    "de",
    "do",
    "da",
    "em",
  ],
  en: [
    "the",
    "and",
    "you",
    "with",
    "our",
    "will",
    "experience",
    "team",
    "for",
    "we",
    "are",
    "of",
    "to",
  ],
  es: [
    "usted",
    "para",
    "con",
    "una",
    "experiencia",
    "nuestro",
    "el",
    "los",
    "las",
    "y",
    "del",
    "en",
    "somos",
  ],
}

/** Language of a posting by stopword frequency. Defaults to pt-BR (Brazilian market). */
export function detectTextLanguage(text: string): TextLanguage {
  const tokens = fold(text)
    .split(/[^a-z]+/)
    .filter(Boolean)
    .slice(0, 3000)
  if (tokens.length === 0) return "pt-BR"
  const counts = new Map<string, number>()
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1)
  let best: TextLanguage = "pt-BR"
  let bestScore = 0
  for (const language of ["pt-BR", "en", "es"] as const) {
    const score = STOPWORDS[language].reduce(
      (sum, word) => sum + (counts.get(word) ?? 0),
      0
    )
    if (score > bestScore) {
      best = language
      bestScore = score
    }
  }
  return best
}
