/**
 * "Dados sensíveis enviados": per-application record of notable/sensitive fields the agent filled.
 * Values are only ever shown to the owner (sealed at rest); admins get counts per category.
 */
import { DATA_CATEGORIES, categoriesForLabels, type DataCategory } from "./permissions.js"

export const REPORT_CATEGORIES: readonly DataCategory[] = [
  "diversidade",
  "saude",
  "documentos",
  "familia",
  "salario",
  "compliance",
  "termos",
  "marketing",
]

/** How the value got there. Only `regra`/`automatico` (standing permissions) trigger notifications. */
export type ReportOrigin = "regra" | "automatico" | "uma_vez" | "perfil"

export const ORIGIN_LABELS: Record<ReportOrigin, string> = {
  regra: "Permitido pela sua lista de sites",
  automatico: "Permitido por 'Sempre permitir'",
  uma_vez: "Aprovado por você na hora",
  perfil: "Preenchido do seu perfil",
}

export type ReportField = {
  question: string
  answer: string
  origin: ReportOrigin
  /** 0..1 when the AI chose the answer; null when it came verbatim from the user/profile. */
  confidence?: number | null
  /** Category forced by the caller (e.g. consent classification); otherwise derived from the label. */
  category?: DataCategory
}

export type SensitiveReportEntry = {
  question: string
  answer: string
  category: DataCategory
  categoryLabel: string
  sensitive: boolean
  origin: ReportOrigin
  confidence: number | null
}

export type SensitiveReport = {
  site: string
  entries: SensitiveReportEntry[]
  generatedAt: string
}

export function buildSensitiveReport(site: string, fields: readonly ReportField[], now = new Date()): SensitiveReport {
  const entries: SensitiveReportEntry[] = []
  const seen = new Set<string>()
  for (const f of fields) {
    const cats = f.category ? [f.category] : categoriesForLabels([f.question])
    for (const category of cats) {
      if (!REPORT_CATEGORIES.includes(category)) continue
      const key = `${f.question}\u0000${category}`
      if (seen.has(key)) continue
      seen.add(key)
      entries.push({
        question: f.question.slice(0, 300),
        answer: f.answer.slice(0, 500),
        category,
        categoryLabel: DATA_CATEGORIES[category].label,
        sensitive: DATA_CATEGORIES[category].sensitive,
        origin: f.origin,
        confidence: typeof f.confidence === "number" ? Math.max(0, Math.min(1, f.confidence)) : null,
      })
    }
  }
  return { site, entries, generatedAt: now.toISOString() }
}

/** Merges segment reports of one run (later answers to the same question replace earlier ones). */
export function mergeReports(a: SensitiveReport | null, b: SensitiveReport): SensitiveReport {
  if (!a) return b
  const map = new Map(a.entries.map((e) => [`${e.question}\u0000${e.category}`, e]))
  for (const e of b.entries) map.set(`${e.question}\u0000${e.category}`, e)
  return { site: b.site, entries: [...map.values()], generatedAt: b.generatedAt }
}

/** Fields filled under a standing permission: the only ones that trigger a notification. */
export function autoFilledEntries(report: SensitiveReport): SensitiveReportEntry[] {
  return report.entries.filter((e) => e.origin === "regra" || e.origin === "automatico")
}

/** Notify only when something was auto-filled and the user opted in (off by default). */
export function shouldNotifySensitive(report: SensitiveReport | null, emailOptIn: boolean): boolean {
  return Boolean(emailOptIn && report && autoFilledEntries(report).length > 0)
}

/** Admin-safe view: counts per category, never questions or answers. */
export function categoryCounts(report: SensitiveReport | null): Partial<Record<DataCategory, number>> {
  const out: Partial<Record<DataCategory, number>> = {}
  for (const e of report?.entries ?? []) out[e.category] = (out[e.category] ?? 0) + 1
  return out
}

/** Subject never carries values, questions or categories. */
export function sensitiveEmailSubject(company: string | null): string {
  return `Resumo de dados enviados na candidatura${company ? ` — ${company.replace(/[\r\n]/g, " ").slice(0, 80)}` : ""}`
}

/** Plain-text body with only the auto-filled entries. */
export function sensitiveEmailBody(report: SensitiveReport, appUrl: string): string {
  const lines = autoFilledEntries(report).map(
    (e) => `• ${e.categoryLabel}: "${e.question}" → "${e.answer}" (${ORIGIN_LABELS[e.origin]})`
  )
  return [
    `O agente preencheu automaticamente, em ${report.site}, os dados abaixo com base nas suas permissões permanentes:`,
    "",
    ...lines,
    "",
    `Para corrigir ou contestar, veja ${appUrl}/app/configuracoes/permissoes.`,
    "Você pode revogar as permissões ou categorias a qualquer momento.",
  ].join("\n")
}

/** "Corrigir/contestar": how to fix an answer on the ATS. */
export function correctionHint(site: string): string {
  return `Entre na sua conta em ${site} (área do candidato / minhas candidaturas) e edite a resposta, se o site permitir. Se não houver edição, contate o recrutador pelo canal da vaga pedindo a correção e, para dados pessoais, exerça seus direitos de titular (LGPD, art. 18) junto à empresa. Depois ajuste seu perfil ou as permissões para as próximas candidaturas.`
}
