/**
 * Deterministic job analysis rules (spec 10.1 item 3, F4–F6, 10.5, prompts P2.2/P2.3).
 * Seniority inference, code-computed alerts, duplicate check, salary suggestion, fit rubric
 * and CV recommendation live here, never in the LLM. Pure: no I/O.
 */

import { normalizeCompanyName, trigramSimilarity } from "./blocklist.js"
import { isSubmittedStatus, type ApplicationStatus } from "./status.js"

export const SENIORITY_LEVELS = [
  "estagio",
  "junior",
  "pleno",
  "senior",
  "especialista",
  "coordenador",
  "gerente",
  "head",
  "diretor",
  "vp",
  "c_level",
] as const
export type Seniority = (typeof SENIORITY_LEVELS)[number]

export const WORK_MODEL_VALUES = ["presencial", "hibrido", "remoto"] as const
export type WorkModel = (typeof WORK_MODEL_VALUES)[number]

export const REGIME_VALUES = ["clt", "pj", "ambos", "nao_informado"] as const
export type Regime = (typeof REGIME_VALUES)[number]

export const LANGUAGE_LEVEL_VALUES = [
  "basico",
  "intermediario",
  "avancado",
  "fluente",
  "nativo",
] as const
export type LanguageLevel = (typeof LANGUAGE_LEVEL_VALUES)[number]

export const JOB_LANGUAGES = ["pt-BR", "en", "es"] as const
export type JobLanguage = (typeof JOB_LANGUAGES)[number]

export const ALERT_CODES = [
  "idioma",
  "local",
  "modelo",
  "regime",
  "senioridade_acima",
  "senioridade_abaixo",
  "salario_fora",
] as const
export type AlertCode = (typeof ALERT_CODES)[number]

export type JobAlert = {
  code: AlertCode
  /** pt-BR sentence for the LLM context and logs; the UI renders by code + params. */
  message: string
  params?: Record<string, string | number>
}

export function isSeniority(value: unknown): value is Seniority {
  return (
    typeof value === "string" &&
    (SENIORITY_LEVELS as readonly string[]).includes(value)
  )
}

export function seniorityRank(value: Seniority): number {
  return SENIORITY_LEVELS.indexOf(value)
}

function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
}

const NON_MANAGEMENT_MANAGER =
  /\b(product|project|account|community|program|customer success|success|marketing|social media|key account)\s+manager\b/

/** Ordered from the most to the least specific; the first match wins. */
const SENIORITY_RULES: readonly [Seniority, RegExp][] = [
  ["c_level", /\b(cto|ceo|cfo|coo|cio|cpo|ciso|chief|c-level)\b/],
  ["vp", /\b(vp|vice[- ]presidente?|vice[- ]president)\b/],
  ["diretor", /\b(diretor|diretora|director)\b/],
  ["head", /\bhead\b/],
  ["gerente", /\b(gerente|manager)\b/],
  ["coordenador", /\b(coordenador|coordenadora|coordinator|coord\.)/],
  ["especialista", /\b(especialista|specialist|staff|principal)\b/],
  ["senior", /\b(senior|sr)\b/],
  ["pleno", /\b(pleno|mid[- ]level|middle)\b/],
  ["junior", /\b(junior|jr)\b/],
  ["estagio", /\b(estagio|estagiari[oa]|intern|internship|trainee)\b/],
]

/**
 * Seniority from PT/EN keywords in the title (P2.2: before the LLM). The description is only
 * read for an explicit "nível: X" / "level: X" line. Returns null when nothing matches.
 */
export function inferSeniority(
  title: string,
  description = ""
): Seniority | null {
  const normalizedTitle = fold(title)
  for (const [level, pattern] of SENIORITY_RULES) {
    if (!pattern.test(normalizedTitle)) continue
    if (level === "gerente" && NON_MANAGEMENT_MANAGER.test(normalizedTitle))
      continue
    return level
  }
  const explicit = /\b(nivel|senioridade|level|seniority)\s*:\s*([^\n]+)/.exec(
    fold(description)
  )
  if (explicit?.[2]) {
    for (const [level, pattern] of SENIORITY_RULES) {
      if (pattern.test(explicit[2])) return level
    }
  }
  return null
}

const LANGUAGE_ALIASES: Record<string, string> = {
  ingles: "en",
  english: "en",
  en: "en",
  espanhol: "es",
  spanish: "es",
  espanol: "es",
  es: "es",
  portugues: "pt",
  portuguese: "pt",
  pt: "pt",
  "pt-br": "pt",
  frances: "fr",
  french: "fr",
  alemao: "de",
  german: "de",
  italiano: "it",
  italian: "it",
  mandarim: "zh",
  chines: "zh",
  japones: "ja",
}

/** "Inglês" / "english" / "en" → "en". Unknown names are returned folded. */
export function normalizeLanguageName(name: string): string {
  const key = fold(name).trim()
  return LANGUAGE_ALIASES[key] ?? key
}

export function languageLevelRank(level: LanguageLevel): number {
  return LANGUAGE_LEVEL_VALUES.indexOf(level) + 1
}

export function isLanguageLevel(value: unknown): value is LanguageLevel {
  return (
    typeof value === "string" &&
    (LANGUAGE_LEVEL_VALUES as readonly string[]).includes(value)
  )
}

const CEFR_TO_LEVEL: Record<string, LanguageLevel> = {
  A1: "basico",
  A2: "basico",
  B1: "intermediario",
  B2: "avancado",
  C1: "fluente",
  C2: "fluente",
}

export function cefrToLevel(
  cefr: string | null | undefined
): LanguageLevel | null {
  return cefr ? (CEFR_TO_LEVEL[cefr.toUpperCase()] ?? null) : null
}

export type DeclaredLanguage = {
  language: string
  level: string
  cefr?: string | null
}

/** Highest declared level for a language, combining the PT label and the CEFR level. */
export function declaredLevel(
  languages: readonly DeclaredLanguage[],
  language: string
): LanguageLevel | null {
  const target = normalizeLanguageName(language)
  let best: LanguageLevel | null = null
  for (const entry of languages) {
    if (normalizeLanguageName(entry.language) !== target) continue
    for (const candidate of [entry.level, cefrToLevel(entry.cefr)]) {
      if (!isLanguageLevel(candidate)) continue
      if (!best || languageLevelRank(candidate) > languageLevelRank(best))
        best = candidate
    }
  }
  return best
}

export type JobForAlerts = {
  seniority: Seniority | null
  workModel: WorkModel | null
  regime: Regime | null
  location: string | null
  languagesRequired: readonly { language: string; level: LanguageLevel }[]
}

export type ProfileForAlerts = {
  languages: readonly DeclaredLanguage[]
  workModels: readonly WorkModel[]
  regimes: readonly ("clt" | "pj")[]
  cities: readonly string[]
  homeCity: string | null
  relocation: "sim" | "nao" | "a_combinar" | null
  /** Levels the user targets (from salary rules). */
  targetSeniorities: readonly Seniority[]
}

const WORK_MODEL_LABEL: Record<WorkModel, string> = {
  presencial: "presencial",
  hibrido: "híbrido",
  remoto: "remoto",
}

const LEVEL_LABEL: Record<LanguageLevel, string> = {
  basico: "básico",
  intermediario: "intermediário",
  avancado: "avançado",
  fluente: "fluente",
  nativo: "nativo",
}

function cityKey(value: string): string {
  return fold(value)
    .replace(/\s*[-–,/]\s*[a-z]{2}$/, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function sameCity(jobLocation: string, city: string): boolean {
  const job = cityKey(jobLocation)
  const wanted = cityKey(city)
  if (!job || !wanted) return false
  return job.includes(wanted) || wanted.includes(job)
}

/** Seniority distance that counts as "muito acima/abaixo" (RF6.1). */
export const SENIORITY_ALERT_DISTANCE = 2

/**
 * Alerts computed in code and handed to the LLM, which cannot remove them (10.5, P2.3).
 * CA6.2: a required language above the declared level always yields `idioma`.
 */
export function computeJobAlerts(
  job: JobForAlerts,
  profile: ProfileForAlerts
): JobAlert[] {
  const alerts: JobAlert[] = []

  for (const required of job.languagesRequired) {
    const code = normalizeLanguageName(required.language)
    if (code === "pt") continue
    const declared = declaredLevel(profile.languages, required.language)
    if (
      !declared ||
      languageLevelRank(declared) < languageLevelRank(required.level)
    ) {
      alerts.push({
        code: "idioma",
        message: `A vaga pede ${required.language} ${LEVEL_LABEL[required.level]}; seu nível declarado é ${declared ? LEVEL_LABEL[declared] : "não informado"}.`,
        params: {
          language: required.language,
          required: required.level,
          declared: declared ?? "nao_informado",
        },
      })
    }
  }

  if (
    job.workModel &&
    profile.workModels.length > 0 &&
    !profile.workModels.includes(job.workModel)
  ) {
    alerts.push({
      code: "modelo",
      message: `Modelo ${WORK_MODEL_LABEL[job.workModel]} fora das suas preferências.`,
      params: { workModel: job.workModel },
    })
  }

  if (
    job.location &&
    (job.workModel === "presencial" || job.workModel === "hibrido") &&
    profile.relocation !== "sim"
  ) {
    const cities =
      profile.cities.length > 0
        ? profile.cities
        : profile.homeCity
          ? [profile.homeCity]
          : []
    if (
      cities.length > 0 &&
      !cities.some((city) => sameCity(job.location ?? "", city))
    ) {
      alerts.push({
        code: "local",
        message: `Local ${job.location} fora das cidades que você aceita.`,
        params: { location: job.location },
      })
    }
  }

  if (
    (job.regime === "clt" || job.regime === "pj") &&
    profile.regimes.length > 0 &&
    !profile.regimes.includes(job.regime)
  ) {
    alerts.push({
      code: "regime",
      message: `Regime ${job.regime.toUpperCase()} fora dos regimes que você aceita.`,
      params: { regime: job.regime },
    })
  }

  if (job.seniority && profile.targetSeniorities.length > 0) {
    const ranks = profile.targetSeniorities.map(seniorityRank)
    const jobRank = seniorityRank(job.seniority)
    if (jobRank - Math.max(...ranks) >= SENIORITY_ALERT_DISTANCE) {
      alerts.push({
        code: "senioridade_acima",
        message: "Senioridade da vaga muito acima do nível que você busca.",
        params: { seniority: job.seniority },
      })
    } else if (Math.min(...ranks) - jobRank >= SENIORITY_ALERT_DISTANCE) {
      alerts.push({
        code: "senioridade_abaixo",
        message: "Senioridade da vaga muito abaixo do nível que você busca.",
        params: { seniority: job.seniority },
      })
    }
  }

  return alerts
}

/** Union of code alerts and model alerts: a code alert is never dropped (10.5). */
export function mergeAlerts(
  codeAlerts: readonly JobAlert[],
  modelAlerts: readonly JobAlert[]
): JobAlert[] {
  const merged = [...codeAlerts]
  const codes = new Set(codeAlerts.map((alert) => alert.code))
  for (const alert of modelAlerts) {
    if (codes.has(alert.code)) continue
    codes.add(alert.code)
    merged.push(alert)
  }
  return merged
}

// ---------------------------------------------------------------------------
// Salary (RF6.3, RF6A.3): purely deterministic
// ---------------------------------------------------------------------------

export type SalaryRule = {
  seniority: Seniority
  regime: Regime
  min: number | null
  target: number
  currency: string
  period: string
}

export type JobSalaryRange = {
  min: number | null
  max: number | null
  currency: string | null
}

export type SalarySuggestion =
  | { status: "no_seniority"; jobRange: JobSalaryRange | null; alert: null }
  | {
      status: "no_rule"
      seniority: Seniority
      jobRange: JobSalaryRange | null
      alert: null
    }
  | {
      status: "rule"
      seniority: Seniority
      rule: SalaryRule
      /** Other matching rules when the job regime is unknown (e.g. CLT and PJ). */
      alternatives: SalaryRule[]
      jobRange: JobSalaryRange | null
      alert: JobAlert | null
    }

const REGIME_PREFERENCE: readonly Regime[] = [
  "clt",
  "pj",
  "ambos",
  "nao_informado",
]

function hasRange(
  range: JobSalaryRange | null | undefined
): range is JobSalaryRange {
  return Boolean(range && (range.min !== null || range.max !== null))
}

/**
 * Suggested pay = the user's rule for (inferred seniority × regime). When the posting has a
 * range, both are shown and `salario_fora` flags a rule outside the range.
 */
export function suggestSalary(
  rules: readonly SalaryRule[],
  input: {
    seniority: Seniority | null
    regime: Regime | null
    jobRange?: JobSalaryRange | null
  }
): SalarySuggestion {
  const jobRange = hasRange(input.jobRange) ? input.jobRange : null
  if (!input.seniority) return { status: "no_seniority", jobRange, alert: null }
  const seniority = input.seniority
  const candidates = rules.filter((rule) => rule.seniority === seniority)
  const regime = input.regime
  const exact =
    regime === "clt" || regime === "pj"
      ? candidates.filter(
          (rule) => rule.regime === regime || rule.regime === "ambos"
        )
      : [...candidates].sort(
          (a, b) =>
            REGIME_PREFERENCE.indexOf(a.regime) -
            REGIME_PREFERENCE.indexOf(b.regime)
        )
  const [rule, ...alternatives] = exact
  if (!rule) return { status: "no_rule", seniority, jobRange, alert: null }

  let alert: JobAlert | null = null
  if (jobRange && (!jobRange.currency || jobRange.currency === rule.currency)) {
    if (jobRange.max !== null && rule.target > jobRange.max) {
      alert = {
        code: "salario_fora",
        message: "A faixa da vaga está abaixo da sua pretensão.",
        params: { direction: "abaixo", target: rule.target, max: jobRange.max },
      }
    } else if (jobRange.min !== null && rule.target < jobRange.min) {
      alert = {
        code: "salario_fora",
        message: "Sua pretensão está abaixo da faixa da vaga.",
        params: { direction: "acima", target: rule.target, min: jobRange.min },
      }
    }
  }
  return {
    status: "rule",
    seniority,
    rule,
    alternatives: regime === "clt" || regime === "pj" ? [] : alternatives,
    jobRange,
    alert,
  }
}

// ---------------------------------------------------------------------------
// Duplicate check (F5 RF5.1, RF5.3, CA5.1)
// ---------------------------------------------------------------------------

export const DUPLICATE_TITLE_SIMILARITY = 0.85
export const DUPLICATE_WINDOW_DAYS = 180

export type TrackedApplication = {
  id: string
  /** Canonical form of `applications.link` (computed by the caller with the adapters). */
  canonicalLink: string | null
  company: string
  roleTitle: string
  status: ApplicationStatus
  appliedAt: string | null
  createdAt: string
}

export type DuplicateGmailHint = {
  searchStatus: "not_connected" | "ok" | "partial"
  matchCount: number
  latestSubject?: string
  latestReceivedAt?: string
}

export type DuplicateGmailSearch =
  | { status: "not_connected" }
  | {
      status: "ok" | "partial"
      matches: readonly { subject: string; receivedAt: string }[]
    }

export type DuplicateCheck =
  | { status: "nao_aplicado"; gmail?: DuplicateGmailHint }
  | {
      status: "ja_aplicado" | "possivel_duplicata"
      applicationId: string
      reason: "url" | "empresa_cargo" | "gmail"
      appliedAt: string | null
      applicationStatus: ApplicationStatus
      similarity: number
      gmail?: DuplicateGmailHint
    }

function normalizeTitle(title: string): string {
  return fold(title)
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/** Title similarity used by the duplicate rule (trigram, like pg_trgm). */
export function titleSimilarity(a: string, b: string): number {
  return trigramSimilarity(normalizeTitle(a), normalizeTitle(b))
}

/**
 * Canonical URL match, OR same normalized company + title similarity ≥ 0.85 within 180 days.
 * `ja_aplicado` only when the matched application was actually sent (with its date);
 * everything else asks for confirmation (`possivel_duplicata`).
 */
export function checkDuplicateInTracker(
  candidate: { canonicalUrl: string; company: string | null; title: string },
  applications: readonly TrackedApplication[],
  now: Date = new Date()
): DuplicateCheck {
  const windowStart =
    now.getTime() - DUPLICATE_WINDOW_DAYS * 24 * 60 * 60 * 1000
  const company = candidate.company
    ? normalizeCompanyName(candidate.company)
    : ""

  const byUrl = applications.find(
    (application) =>
      application.canonicalLink &&
      application.canonicalLink === candidate.canonicalUrl
  )
  if (byUrl) {
    return {
      status: isSubmittedStatus(byUrl.status)
        ? "ja_aplicado"
        : "possivel_duplicata",
      applicationId: byUrl.id,
      reason: "url",
      appliedAt: byUrl.appliedAt,
      applicationStatus: byUrl.status,
      similarity: 1,
    }
  }

  if (!company) return { status: "nao_aplicado" }
  let best: { application: TrackedApplication; similarity: number } | null =
    null
  for (const application of applications) {
    const reference = application.appliedAt ?? application.createdAt
    if (new Date(reference).getTime() < windowStart) continue
    if (normalizeCompanyName(application.company) !== company) continue
    const similarity = titleSimilarity(candidate.title, application.roleTitle)
    if (
      similarity >= DUPLICATE_TITLE_SIMILARITY &&
      similarity > (best?.similarity ?? 0)
    ) {
      best = { application, similarity }
    }
  }
  if (!best) return { status: "nao_aplicado" }
  return {
    status: "possivel_duplicata",
    applicationId: best.application.id,
    reason: "empresa_cargo",
    appliedAt: best.application.appliedAt,
    applicationStatus: best.application.status,
    similarity: best.similarity,
  }
}

function gmailHintFromSearch(gmail: DuplicateGmailSearch): DuplicateGmailHint {
  if (gmail.status === "not_connected") {
    return { searchStatus: "not_connected", matchCount: 0 }
  }
  const latest = gmail.matches[0]
  return {
    searchStatus: gmail.status,
    matchCount: gmail.matches.length,
    latestSubject: latest?.subject,
    latestReceivedAt: latest?.receivedAt,
  }
}

/**
 * RF5.2: attach Gmail header search to the tracker duplicate check. When the inbox suggests a
 * prior application and the tracker has a related row, surface `possivel_duplicata` (reason gmail).
 */
export function mergeDuplicateWithGmail(
  duplicate: DuplicateCheck,
  gmail: DuplicateGmailSearch,
  relatedApplication?: TrackedApplication | null,
  titleSimilarityScore = 0
): DuplicateCheck {
  const gmailHint = gmailHintFromSearch(gmail)
  if (gmailHint.matchCount === 0) {
    return duplicate.status === "nao_aplicado"
      ? { ...duplicate, gmail: gmailHint }
      : { ...duplicate, gmail: gmailHint }
  }
  if (duplicate.status === "ja_aplicado") {
    return { ...duplicate, gmail: gmailHint }
  }
  if (duplicate.status === "possivel_duplicata") {
    return { ...duplicate, gmail: gmailHint }
  }
  if (relatedApplication) {
    return {
      status: "possivel_duplicata",
      applicationId: relatedApplication.id,
      reason: "gmail",
      appliedAt: relatedApplication.appliedAt,
      applicationStatus: relatedApplication.status,
      similarity: titleSimilarityScore,
      gmail: gmailHint,
    }
  }
  return { status: "nao_aplicado", gmail: gmailHint }
}

// ---------------------------------------------------------------------------
// Fit rubric (10.5) and CV recommendation (RF6.2)
// ---------------------------------------------------------------------------

export const FIT_LEVEL_VALUES = ["alto", "medio", "baixo"] as const
export type FitLevelValue = (typeof FIT_LEVEL_VALUES)[number]

/** `salario_fora` informs; every other code alert blocks "alto". */
export function isBlockingAlert(code: AlertCode): boolean {
  switch (code) {
    case "idioma":
    case "local":
    case "modelo":
    case "regime":
    case "senioridade_acima":
    case "senioridade_abaixo":
      return true
    case "salario_fora":
      return false
    default: {
      const unreachable: never = code
      throw new Error(`Unknown alert code: ${String(unreachable)}`)
    }
  }
}

/**
 * alto = every required item covered by facts and no blocking alert;
 * medio = up to 2 required items uncovered or 1 alert; baixo = the rest.
 */
export function fitFromRubric(input: {
  uncoveredRequired: number
  alerts: readonly { code: AlertCode }[]
}): FitLevelValue {
  const blocking = input.alerts.filter((alert) =>
    isBlockingAlert(alert.code)
  ).length
  if (input.uncoveredRequired === 0 && blocking === 0) return "alto"
  if (input.uncoveredRequired <= 2 && blocking <= 1) return "medio"
  return "baixo"
}

const FIT_ORDER: Record<FitLevelValue, number> = { alto: 2, medio: 1, baixo: 0 }

/** The model may be more cautious than the rubric, never more optimistic. */
export function capFitByRubric(
  modelFit: FitLevelValue,
  rubricFit: FitLevelValue
): FitLevelValue {
  return FIT_ORDER[modelFit] <= FIT_ORDER[rubricFit] ? modelFit : rubricFit
}

export type CvVersionOption = {
  id: string
  trackId: string | null
  language: string
  isDefault: boolean
}

export type CvRecommendation = {
  cvVersionId: string | null
  trackId: string | null
  language: JobLanguage
  reason:
    | "track_similarity"
    | "default_tie"
    | "default_only"
    | "language_fallback"
    | "none"
}

/** Ties within this margin go to the user's default (RF6.2 "empate → padrão"). */
export const TRACK_TIE_EPSILON = 0.01

/**
 * CV = job language + the track whose facts are most similar to the requirements;
 * a tie goes to the default version. Falls back to any language when none matches.
 */
export function recommendCv(input: {
  jobLanguage: JobLanguage
  trackScores: readonly { trackId: string; similarity: number }[]
  versions: readonly CvVersionOption[]
}): CvRecommendation {
  const inLanguage = input.versions.filter(
    (version) => version.language === input.jobLanguage
  )
  const pool = inLanguage.length > 0 ? inLanguage : input.versions
  if (pool.length === 0) {
    return {
      cvVersionId: null,
      trackId: null,
      language: input.jobLanguage,
      reason: "none",
    }
  }
  const fallbackReason = inLanguage.length > 0 ? null : "language_fallback"
  const defaultVersion = pool.find((version) => version.isDefault) ?? pool[0]
  const scored = input.trackScores
    .filter((score) =>
      pool.some((version) => version.trackId === score.trackId)
    )
    .sort((a, b) => b.similarity - a.similarity)
  const top = scored[0]
  if (!top || !defaultVersion) {
    return {
      cvVersionId: defaultVersion?.id ?? null,
      trackId: defaultVersion?.trackId ?? null,
      language: input.jobLanguage,
      reason: fallbackReason ?? "default_only",
    }
  }
  const tied = scored.filter(
    (score) => top.similarity - score.similarity <= TRACK_TIE_EPSILON
  )
  const defaultTied = tied.some(
    (score) => score.trackId === defaultVersion.trackId
  )
  if (tied.length > 1 && defaultTied) {
    return {
      cvVersionId: defaultVersion.id,
      trackId: defaultVersion.trackId,
      language: input.jobLanguage,
      reason: fallbackReason ?? "default_tie",
    }
  }
  const versionsOfTrack = pool.filter(
    (version) => version.trackId === top.trackId
  )
  const chosen =
    versionsOfTrack.find((version) => version.isDefault) ?? versionsOfTrack[0]
  return {
    cvVersionId: chosen?.id ?? defaultVersion.id,
    trackId: top.trackId,
    language: input.jobLanguage,
    reason: fallbackReason ?? "track_similarity",
  }
}
