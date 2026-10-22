/**
 * Neutral CV filename (spec F3 RF3.3, CA3.1, RF3A.4). The original upload name never leaks:
 * the name is rebuilt from the profile, the CV language and the user's pattern.
 */

export const DEFAULT_CV_FILENAME_PATTERN = "CV-{first}-{last}-{lang}"

export const CV_LANGUAGES = ["pt-BR", "en", "es"] as const
export type CvLanguage = (typeof CV_LANGUAGES)[number]

export const CV_FILE_EXTENSIONS = ["pdf", "docx"] as const
export type CvFileExtension = (typeof CV_FILE_EXTENSIONS)[number]

export type CvFilenameProfile = {
  firstName?: string | null
  lastName?: string | null
  displayName?: string | null
}

const LANGUAGE_LABELS: Record<CvLanguage, string> = {
  "pt-BR": "PT",
  en: "EN",
  es: "ES",
}

export function isCvLanguage(value: string): value is CvLanguage {
  return (CV_LANGUAGES as readonly string[]).includes(value)
}

/** ASCII letters, digits and single dashes only: "João da Silva" → "Joao-da-Silva". */
function sanitizeSegment(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function nameParts(profile: CvFilenameProfile): {
  first: string
  last: string
} {
  const display = (profile.displayName ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  const first = profile.firstName?.trim() || display[0] || ""
  const last =
    profile.lastName?.trim() ||
    (display.length > 1 ? display.slice(1).join(" ") : "")
  return { first, last }
}

/**
 * Builds e.g. `CV-Marina-Alves-PT.pdf`. Supported tokens: `{first}`, `{last}`, `{full}`, `{lang}`.
 * Unknown tokens and characters outside [A-Za-z0-9_-] are dropped.
 */
export function buildCvFilename(
  profile: CvFilenameProfile,
  language: CvLanguage,
  pattern: string = DEFAULT_CV_FILENAME_PATTERN,
  extension: CvFileExtension = "pdf"
): string {
  const { first, last } = nameParts(profile)
  const values: Record<string, string> = {
    first: sanitizeSegment(first),
    last: sanitizeSegment(last),
    full: sanitizeSegment(`${first} ${last}`),
    lang: LANGUAGE_LABELS[language],
  }
  const source = pattern.trim() || DEFAULT_CV_FILENAME_PATTERN
  const filled = source.replace(
    /\{(\w+)\}/g,
    (_, token: string) => values[token] ?? ""
  )
  const base = filled
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/([-_])[-_]+/g, "$1")
    .replace(/^[-_]+|[-_]+$/g, "")
  return `${base || `CV-${LANGUAGE_LABELS[language]}`}.${extension}`
}
