/**
 * "Permissões do agente": the user decides, per action type, whether the agent asks every time,
 * acts on allowlisted sites, or always acts — like Cursor's command allowlist / auto-run.
 * Pure resolution logic; storage lives in agent_permissions / agent_permission_rules.
 */

import type { SiteRiskLevel } from "./risks.js"

export const PERMISSION_ACTIONS = [
  "accept_site_terms",
  "create_site_account",
  "open_email_link",
  "use_email_code",
  "final_submit",
  "accept_marketing_optin",
] as const
export type PermissionAction = (typeof PERMISSION_ACTIONS)[number]

export const PERMISSION_MODES = ["ask", "allowlist", "auto", "deny"] as const
export type PermissionMode = (typeof PERMISSION_MODES)[number]

export const MODE_LABELS: Record<PermissionMode, string> = {
  ask: "Sempre perguntar",
  allowlist: "Permitir em sites da lista",
  auto: "Sempre permitir",
  deny: "Sempre negar",
}

export const ACTION_INFO: Record<
  PermissionAction,
  { title: string; description: string; defaultMode: PermissionMode; needsExtraConfirmation?: boolean }
> = {
  accept_site_terms: {
    title: "Aceitar termos de sites",
    description: "Marcar a caixa de termos de uso / privacidade exigida pelo site da vaga.",
    defaultMode: "ask",
  },
  create_site_account: {
    title: "Criar conta no site",
    description: "Criar uma conta no ATS com seu e-mail e uma senha gerada (guardada criptografada).",
    defaultMode: "ask",
  },
  open_email_link: {
    title: "Abrir link de confirmação do e-mail",
    description: "Abrir o link de verificação enviado pelo próprio site da vaga ao seu Gmail.",
    defaultMode: "ask",
  },
  use_email_code: {
    title: "Usar código recebido por e-mail",
    description: "Digitar o código de verificação enviado pelo próprio site da vaga ao seu Gmail.",
    defaultMode: "ask",
  },
  final_submit: {
    title: "Enviar a candidatura final",
    description: "Enviar sem a sua revisão. Exige confirmação adicional; desligado por padrão.",
    defaultMode: "ask",
    needsExtraConfirmation: true,
  },
  accept_marketing_optin: {
    title: "Aceitar marketing / ofertas",
    description: "Caixas de newsletter, ofertas e comunicações. Negadas por padrão.",
    defaultMode: "deny",
  },
}

/** Typed by the user to turn on automatic final submit. */
export const FINAL_SUBMIT_CONFIRMATION = "ENVIAR SEM REVISAR"

export const PERMISSION_ACK_TEXT =
  "Ao ativar esta permissão, nomeio o VagaPilot meu mandatário para praticar esta ação em meu nome, sem me perguntar, nos sites indicados — inclusive aceitar os termos desses sites, que valerão como aceitos por mim. Vale só para as categorias de dados que eu marcar; dados sensíveis exigem confirmação própria. Posso revogar a permissão ou qualquer categoria a qualquer momento. Sites de alto risco sempre perguntam."


/** Data categories a standing permission covers. Each must be confirmed explicitly. */
export const DATA_CATEGORIES = {
  contato: { label: "Dados de contato (nome, e-mail, telefone)", sensitive: false },
  documentos: { label: "Documentos (CPF/RG)", sensitive: false },
  endereco: { label: "Endereço", sensitive: false },
  salario: { label: "Pretensão salarial", sensitive: false },
  familia: { label: "Dados familiares / estado civil", sensitive: false },
  diversidade: { label: "Diversidade (raça/cor, gênero, orientação sexual)", sensitive: true },
  saude: { label: "Saúde / PcD", sensitive: true },
  compliance: { label: "Antecedentes, vínculos e compliance", sensitive: false },
  termos: { label: "Termos e políticas do site", sensitive: false },
  marketing: { label: "Marketing / opt-in", sensitive: false },
} as const
export type DataCategory = keyof typeof DATA_CATEGORIES
export const DATA_CATEGORY_KEYS = Object.keys(DATA_CATEGORIES) as DataCategory[]

export const SENSITIVE_CATEGORY_NOTE =
  "Dado sensível (LGPD, art. 11): raça/cor, gênero, orientação sexual, saúde e deficiência só podem ser tratados com o seu consentimento específico e destacado. Ao marcar, você autoriza o agente a informar e consentir com esse dado em seu nome nos sites cobertos."

/** Typed by the user to cover sensitive categories. */
export const SENSITIVE_CONFIRMATION = "AUTORIZO DADOS SENSIVEIS"

const CATEGORY_PATTERNS: [DataCategory, RegExp][] = [
  ["diversidade", /(ra[cç]a|etnia|cor da pele|\bcor\b|g[eê]nero|orienta[cç][aã]o sexual|identidade|diversidade|lgbt|ethnic|diversity|gender|religi)/],
  ["saude", /(sa[uú]de|defici[eê]ncia|\bpcd\b|laudo|cid\b|health|disabilit|biom[eé]tric)/],
  ["documentos", /(\bcpf\b|\brg\b|documento|identidade civil|passaporte|cnh|pis|ctps)/],
  ["endereco", /(endere[cç]o|\bcep\b|cidade|bairro|logradouro|address)/],
  ["salario", /(sal[aá]ri|pretens[aã]o|remunera|salary)/],
  ["familia", /(estado civil|c[oô]njuge|filhos|dependentes|familia|marital)/],
  ["compliance", /(antecedente|criminal|parente|v[ií]nculo|conflito de interesse|compliance|funcion[aá]rio p[uú]blico|sindica|pol[ií]tic)/],
  ["marketing", /(marketing|newsletter|ofertas|novidades|promo|comunica[cç][oõ]es|parceiros)/],
  ["termos", /(termo|pol[ií]tica|privacidade|consentimento|aceito|concordo|terms|privacy)/],
  ["contato", /(e-?mail|telefone|celular|whats|nome|linkedin|phone|contact)/],
]

/** Categories a set of field labels touches. */
export function categoriesForLabels(labels: readonly string[]): DataCategory[] {
  const out = new Set<DataCategory>()
  for (const label of labels) {
    const l = label.toLowerCase()
    for (const [cat, re] of CATEGORY_PATTERNS) if (re.test(l)) out.add(cat)
  }
  return DATA_CATEGORY_KEYS.filter((c) => out.has(c))
}

export function hasSensitive(categories: readonly DataCategory[]): boolean {
  return categories.some((c) => DATA_CATEGORIES[c].sensitive)
}

/** Validates a grant: every sensitive category needs the typed confirmation. */
export function categoryGrantOk(categories: readonly DataCategory[], typed: string | null | undefined): boolean {
  if (!categories.length) return false
  if (!hasSensitive(categories)) return true
  return (typed ?? "").trim().toUpperCase() === SENSITIVE_CONFIRMATION
}

export type PermissionRule = {
  id?: string
  action: PermissionAction
  pattern: string
  effect: "allow" | "deny"
  /** Allow rules only: data categories the user confirmed for this site. */
  categories?: readonly DataCategory[]
}

export type PermissionSetting = {
  mode: PermissionMode
  /** "auto" mode: data categories confirmed for every site. */
  categories?: readonly DataCategory[]
  /** final_submit only: when the user typed the extra confirmation. */
  confirmedAt?: string | null
}

export type PermissionContext = {
  action: PermissionAction
  host: string
  settings: Partial<Record<PermissionAction, PermissionSetting>>
  rules: readonly PermissionRule[]
  siteRisk?: SiteRiskLevel | null
  /** Data categories this step touches; all must be confirmed for an automatic decision. */
  categories?: readonly DataCategory[]
}

export type PermissionDecision = {
  decision: "allow" | "ask" | "deny"
  reason:
    | "deny_rule"
    | "missing_category"
    | "high_risk_site"
    | "allow_rule"
    | "mode_auto"
    | "mode_deny"
    | "mode_ask"
    | "not_listed"
    | "final_submit_unconfirmed"
  rule?: PermissionRule
  /** missing_category: what the user still has to confirm (quick "add" on the card). */
  missing?: DataCategory[]
}

/** Normalizes a domain pattern: lower case, no scheme/path/port; "*.x" or "x". Null if invalid. */
export function normalizePattern(input: string): string | null {
  let p = input.trim().toLowerCase()
  p = p.replace(/^[a-z]+:\/\//, "").split(/[/?#:]/)[0] ?? ""
  if (p.startsWith("*.")) {
    const rest = p.slice(2)
    return /^([a-z0-9-]+\.)+[a-z]{2,}$/.test(rest) ? `*.${rest}` : null
  }
  return /^([a-z0-9-]+\.)+[a-z]{2,}$/.test(p) ? p : null
}

/** "*.gupy.io" matches sub domains AND gupy.io itself; "gupy.io" matches exactly gupy.io (and www.). */
export function patternMatches(pattern: string, host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "")
  const p = pattern.toLowerCase()
  if (p.startsWith("*.")) {
    const base = p.slice(2)
    return h === base || h.endsWith(`.${base}`)
  }
  return h === p || h === `www.${p}`
}

/**
 * Precedence: deny rule > mode deny > high-risk site > (allow rule | auto mode) with every touched
 * data category confirmed > ask. Allow rules apply in "allowlist" and "auto" modes ("ask" ignores
 * them). Final submit needs the extra confirmation for any automatic path.
 */
export function resolvePermission(ctx: PermissionContext): PermissionDecision {
  const setting = ctx.settings[ctx.action] ?? { mode: ACTION_INFO[ctx.action].defaultMode }
  const rules = ctx.rules.filter((r) => r.action === ctx.action && patternMatches(r.pattern, ctx.host))
  const deny = rules.find((r) => r.effect === "deny")
  if (deny) return { decision: "deny", reason: "deny_rule", rule: deny }
  if (setting.mode === "deny") return { decision: "deny", reason: "mode_deny" }
  if (ctx.siteRisk === "alto") return { decision: "ask", reason: "high_risk_site" }
  if (setting.mode === "ask") return { decision: "ask", reason: "mode_ask" }
  if (ACTION_INFO[ctx.action].needsExtraConfirmation && !setting.confirmedAt)
    return { decision: "ask", reason: "final_submit_unconfirmed" }
  const touched = ctx.categories ?? []
  const missingFor = (confirmed: readonly DataCategory[] | undefined) =>
    touched.filter((c) => !(confirmed ?? []).includes(c))
  const allows = rules.filter((r) => r.effect === "allow")
  for (const rule of allows)
    if (!missingFor(rule.categories).length) return { decision: "allow", reason: "allow_rule", rule }
  if (setting.mode === "auto" && !missingFor(setting.categories).length)
    return { decision: "allow", reason: "mode_auto" }
  const candidates = [
    ...allows.map((r) => missingFor(r.categories)),
    ...(setting.mode === "auto" ? [missingFor(setting.categories)] : []),
  ]
  if (!candidates.length) return { decision: "ask", reason: "not_listed" }
  const missing = candidates.reduce((a, b) => (b.length < a.length ? b : a))
  return { decision: "ask", reason: "missing_category", missing, rule: allows[0] }
}

/** Consent box classification: marketing vs site terms, plus every data category it mentions. */
export function consentActionFor(label: string): { action: PermissionAction; categories: DataCategory[] } {
  const found = categoriesForLabels([label]).filter((c) => c !== "contato")
  const marketing = found.includes("marketing")
  const categories = found.length ? found : ["termos" as DataCategory]
  if (!marketing && !categories.includes("termos")) categories.unshift("termos")
  return { action: marketing ? "accept_marketing_optin" : "accept_site_terms", categories }
}

/** Buttons of the inline card (like Cursor's run prompt). */
export const CARD_CHOICES = {
  once: "Permitir uma vez",
  always: "Sempre permitir neste site",
  deny: "Negar",
  denyAlways: "Negar sempre neste site",
} as const
export type CardChoice = keyof typeof CARD_CHOICES

export function cardChoiceFor(answer: string): CardChoice | null {
  const entry = Object.entries(CARD_CHOICES).find(([, label]) => label === answer)
  return entry ? (entry[0] as CardChoice) : null
}

/** Rule + mode change implied by a card click (null: one-off decision). */
export function ruleFromCardChoice(
  choice: CardChoice,
  action: PermissionAction,
  host: string,
  current: PermissionMode,
  categories: readonly DataCategory[] = []
): { rule: PermissionRule; mode: PermissionMode } | null {
  const pattern = normalizePattern(host)
  if (!pattern) return null
  if (choice === "always")
    return {
      rule: { action, pattern, effect: "allow", categories: [...categories] },
      mode: current === "ask" || current === "deny" ? "allowlist" : current,
    }
  if (choice === "denyAlways") return { rule: { action, pattern, effect: "deny" }, mode: current }
  return null
}

/**
 * Card buttons. "always" stays available for sensitive data too, but the UI then requires the
 * category ticks + typed confirmation; high-risk sites and final submit never offer it.
 */
export function cardChoicesFor(ctx: { action: PermissionAction; siteRisk?: SiteRiskLevel | null }): CardChoice[] {
  const canAlways = ctx.siteRisk !== "alto" && !ACTION_INFO[ctx.action].needsExtraConfirmation
  return canAlways ? ["once", "always", "deny", "denyAlways"] : ["once", "deny", "denyAlways"]
}

/** Whether a change grants standing authority (must be recorded in the evidence log). */
export function isGrant(mode: PermissionMode): boolean {
  return mode === "allowlist" || mode === "auto"
}
