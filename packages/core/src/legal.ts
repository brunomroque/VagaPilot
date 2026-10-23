/**
 * Versioned legal documents and electronic-acceptance evidence helpers.
 *
 * Texts live in docs/legal/*.md as templates with {{UPPER_SNAKE}} tags and are seeded into
 * public.legal_documents. Company values live ONLY in LEGAL_VARS below. The acceptance hash is
 * computed over the RENDERED text (what the user actually saw), never the template.
 */
import { createHash } from "node:crypto"

export const LEGAL_VARS = {
  RAZAO_SOCIAL: "",
  NOME_FANTASIA: "VagaPilot",
  CNPJ: "",
  ENDERECO: "",
  CIDADE_UF: "",
  EMAIL_CONTATO: "",
  EMAIL_ENCARREGADO: "",
  NOME_ENCARREGADO: "",
  SITE_URL: "https://vagapilot.app",
} as const satisfies Record<string, string>

export const LEGAL_TAGS = [
  ...Object.keys(LEGAL_VARS),
  "DATA_VIGENCIA",
  "VERSAO",
] as readonly string[]

export type LegalSlug = "termos-de-uso" | "politica-de-privacidade" | "termo-riscos-automacao"

/** Current version of each document; bump to force re-acceptance. Must exist in legal_documents. */
export const LEGAL_CURRENT_VERSIONS: Record<LegalSlug, string> = {
  "termos-de-uso": "2026-10-23.1",
  "politica-de-privacidade": "2026-10-23.1",
  "termo-riscos-automacao": "2026-10-23.1",
}

/** Documents that must be accepted before the first cloud apply. */
export const CLOUD_APPLY_REQUIRED_DOCS: readonly LegalSlug[] = [
  "termos-de-uso",
  "politica-de-privacidade",
  "termo-riscos-automacao",
]

/** One unbundled, never pre-checked checkbox per key risk of the automation term. */
export const RISK_ACCEPT_CLAUSES = [
  { id: "sites_bloqueiam_bots", label: "Entendo que alguns sites proíbem robôs e que minha conta no site pode ser bloqueada ou a candidatura recusada." },
  { id: "termos_de_sites", label: "Entendo que o sistema nunca aceita termos de sites por mim e que, ao clicar em \"Aceito\", sou eu quem aceita." },
  { id: "contas_e_senhas", label: "Autorizo, quando eu confirmar, a criação de contas em sites com meu e-mail e senha gerada guardada criptografada." },
  { id: "email_e_links", label: "Entendo que, com o Gmail conectado, e-mails das candidaturas são lidos e links do site da candidatura são abertos." },
  { id: "erros_ia", label: "Entendo que a IA pode errar e que devo revisar o resumo antes de aprovar o envio." },
  { id: "receita_desatualizada", label: "Entendo que receitas aprendidas podem ficar desatualizadas." },
  { id: "provedores_exterior", label: "Estou ciente de que meus dados passam por provedores nos Estados Unidos (transferência internacional)." },
  { id: "cotas", label: "Entendo que cotas gratuitas podem acabar e o serviço pode ficar indisponível." },
  { id: "responsabilidade", label: "Sou o autor das candidaturas e respondo pelos dados e aceites que fizer." },
] as const

export const DOC_ACCEPT_CLAUSES: Record<LegalSlug, readonly { id: string; label: string }[]> = {
  "termos-de-uso": [{ id: "li_termos", label: "Li e aceito os Termos de Uso, incluindo as cláusulas destacadas em negrito." }],
  "politica-de-privacidade": [
    { id: "ciente_privacidade", label: "Li a Política de Privacidade." },
    { id: "transferencia_internacional", label: "Consinto com a transferência internacional dos meus dados descrita no item 6." },
  ],
  "termo-riscos-automacao": RISK_ACCEPT_CLAUSES,
}

const TAG_RE = /\{\{([A-Z][A-Z0-9_]*)\}\}/g

export type RenderedLegal = { text: string; missing: string[]; sha256: string }

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex")
}

/** Render a template; any tag with an empty/unknown value stays as-is and is reported missing. */
export function renderLegal(
  template: string,
  doc: { version: string; effectiveDate: string },
  vars: Record<string, string> = LEGAL_VARS
): RenderedLegal {
  const all: Record<string, string> = { ...vars, VERSAO: doc.version, DATA_VIGENCIA: doc.effectiveDate }
  const missing = new Set<string>()
  const text = template.replace(/\r\n/g, "\n").replace(TAG_RE, (whole, tag: string) => {
    const value = all[tag]?.trim()
    if (!value || /\{\{[A-Z]/.test(value)) {
      missing.add(tag)
      return whole
    }
    return value
  })
  return { text, missing: [...missing].sort(), sha256: sha256Hex(text) }
}

/** Drafts with unfilled tags can only be accepted when explicitly allowed (dev/staging). */
export function legalPublishable(rendered: Pick<RenderedLegal, "missing">, allowDraft: boolean): boolean {
  return rendered.missing.length === 0 || allowDraft
}

/** Deterministic JSON: sorted keys, no whitespace. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`
}

export type EvidencePayload = {
  user_id: string
  email: string | null
  /** permission_*: standing agent permissions (see permissions.ts), chained in the same log. */
  action: "accept" | "revoke" | "permission_grant" | "permission_revoke"
  document_slug: string
  document_version: string
  document_sha256: string
  checkboxes: Record<string, boolean>
  typed_confirmation: string | null
  accepted_at: string
  ip: string | null
  user_agent: string | null
  session_id: string | null
  locale: string | null
  ui_version: string | null
}

export function evidenceHash(prevHash: string | null, payload: EvidencePayload): string {
  return sha256Hex(`${prevHash ?? "GENESIS"}\n${canonicalJson(payload)}`)
}

export type EvidenceRecord = EvidencePayload & { prev_hash: string | null; record_hash: string }

/** Verify a user's chain in insertion order. Returns the first broken index, or -1. */
export function verifyEvidenceChain(records: readonly EvidenceRecord[]): number {
  let prev: string | null = null
  for (let i = 0; i < records.length; i++) {
    const { prev_hash, record_hash, ...payload } = records[i]!
    if (prev_hash !== prev) return i
    if (evidenceHash(prev, payload) !== record_hash) return i
    prev = record_hash
  }
  return -1
}

export type LatestAcceptance = { action: "accept" | "revoke"; document_version: string; document_sha256: string }

/** Which required docs still need (re-)acceptance: none, revoked, outdated version or changed text. */
export function documentsNeedingAcceptance(
  latest: Partial<Record<LegalSlug, LatestAcceptance | undefined>>,
  current: Partial<Record<LegalSlug, { version: string; sha256: string }>>,
  required: readonly LegalSlug[] = CLOUD_APPLY_REQUIRED_DOCS
): LegalSlug[] {
  return required.filter((slug) => {
    const l = latest[slug]
    const c = current[slug]
    if (!c) return true
    return !l || l.action !== "accept" || l.document_version !== c.version || l.document_sha256 !== c.sha256
  })
}

/** Every clause checkbox must be explicitly true. */
export function allClausesChecked(slug: LegalSlug, checkboxes: Record<string, unknown>): boolean {
  return DOC_ACCEPT_CLAUSES[slug].every((c) => checkboxes[c.id] === true)
}

export function typedConfirmationOk(typed: string | null | undefined, fullName: string | null | undefined): boolean {
  const t = (typed ?? "").trim()
  if (!t) return true // optional
  if (t.toUpperCase() === "ACEITO") return true
  return !!fullName && t.localeCompare(fullName.trim(), "pt-BR", { sensitivity: "base" }) === 0
}

export const FRESH_SESSION_MS = 5 * 60 * 1000

export function sessionIsFresh(lastSignInAt: string | null | undefined, now = Date.now()): boolean {
  if (!lastSignInAt) return false
  const t = Date.parse(lastSignInAt)
  return Number.isFinite(t) && now - t >= -60_000 && now - t < FRESH_SESSION_MS
}

/** Snapshot hash of a third-party site's terms text (normalized whitespace). */
export function termsSnapshotHash(text: string): string {
  return sha256Hex(text.replace(/\s+/g, " ").trim())
}
