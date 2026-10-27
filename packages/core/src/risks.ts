/**
 * Automation risk catalog and contextual alert triggers (pt-BR, shown in the chat, the apply
 * panel, the review and Configurações → Riscos e responsabilidades).
 */

export type RiskSeverity = "info" | "atencao" | "alto"

export type RiskId =
  | "sites_bloqueiam_bots"
  | "termos_de_sites"
  | "contas_e_senhas"
  | "email_e_links"
  | "erros_ia"
  | "receita_desatualizada"
  | "linkedin"
  | "provedores_exterior"
  | "navegador_local"
  | "cotas"
  | "responsabilidade"

export type Risk = {
  id: RiskId
  severity: RiskSeverity
  title: string
  short: string
  more: string
}

export const RISK_CATALOG: readonly Risk[] = [
  {
    id: "sites_bloqueiam_bots",
    severity: "alto",
    title: "Sites que proíbem robôs",
    short:
      "Alguns sites proíbem automação. Sua conta no site pode ser bloqueada ou a candidatura recusada.",
    more: "Avisamos quando o site é conhecido como restritivo, mas a lista pode estar incompleta. A decisão de prosseguir é sua; você pode se candidatar manualmente.",
  },
  {
    id: "termos_de_sites",
    severity: "alto",
    title: "Termos de sites aceitos só por você",
    short:
      "Nunca marcamos termos, privacidade, marketing ou consentimentos por você. A execução pausa e você decide.",
    more: 'Ao clicar em "Aceito", é você quem aceita os termos daquele site. Registramos a decisão com o link do texto e uma impressão digital (hash) dele.',
  },
  {
    id: "contas_e_senhas",
    severity: "atencao",
    title: "Criação de contas e senhas",
    short:
      "Se autorizado, criamos uma conta no site com seu e-mail e uma senha gerada, guardada criptografada.",
    more: "A conta é sua e segue os termos do site. Veja ou troque a senha em Configurações → Sites conectados.",
  },
  {
    id: "email_e_links",
    severity: "atencao",
    title: "Leitura de e-mail e abertura de links",
    short:
      "Com o Gmail conectado, lemos e-mails das candidaturas para achar respostas, códigos e links de confirmação.",
    more: "Só e-mails ligados a candidaturas ativas ou conhecidas, e só links do domínio do site da candidatura. Instruções em e-mails nunca são seguidas.",
  },
  {
    id: "erros_ia",
    severity: "alto",
    title: "A IA pode errar",
    short:
      "A IA pode preencher um dado incorreto. Respostas de baixa confiança aparecem destacadas na revisão.",
    more: "Revise sempre o resumo antes de aprovar: o que você aprovar será enviado em seu nome.",
  },
  {
    id: "receita_desatualizada",
    severity: "atencao",
    title: "Receitas aprendidas podem estar desatualizadas",
    short:
      "Em sites novos repetimos passos aprendidos. Se o site mudou, a receita pode falhar.",
    more: "Quando não for seguro, a execução revalida a etapa com IA ou pausa e pede sua confirmação.",
  },
  {
    id: "linkedin",
    severity: "info",
    title: "LinkedIn desativado",
    short:
      "A candidatura automatizada no LinkedIn está desativada pelas regras daquela plataforma.",
    more: "Você pode se candidatar no LinkedIn manualmente; organizamos o acompanhamento.",
  },
  {
    id: "navegador_local",
    severity: "alto",
    title: "Automação no SEU navegador e nas SUAS contas",
    short:
      "Por padrão, a automação roda no seu próprio Chrome, logado nas suas contas reais (LinkedIn, Gupy e outras). Usamos isso porque sites bloqueiam menos um navegador real do que um robô na nuvem — mas o risco não some: sua conta pode ser limitada, suspensa ou bloqueada.",
    more: "O VagaPilot não garante nenhuma conta sua e não se responsabiliza por bloqueios, limitações ou perda de acesso. Ao continuar, você assume esse risco. Se o seu navegador local não estiver disponível, usamos um navegador na nuvem (Browserbase) como alternativa; ele também pode ser detectado e bloqueado, e seus dados passam por servidores nos EUA. Prefere não arriscar? Candidate-se manualmente.",
  },
  {
    id: "provedores_exterior",
    severity: "atencao",
    title: "Navegador na nuvem e provedores nos EUA",
    short:
      "Seus dados de candidatura passam por provedores (Browserbase, Kernel, Steel, Browserless) nos Estados Unidos.",
    more: "Também usamos Supabase, Upstash, Netlify e Google Gemini. Detalhes e transferência internacional na Política de Privacidade.",
  },
  {
    id: "cotas",
    severity: "info",
    title: "Cotas gratuitas e disponibilidade",
    short:
      "Parte do serviço usa cotas gratuitas ou limitadas. Quando acabam, a candidatura pode atrasar ou ficar indisponível.",
    more: "Não há garantia de disponibilidade contínua.",
  },
  {
    id: "responsabilidade",
    severity: "alto",
    title: "Você é o responsável pelo que é enviado",
    short:
      "Você é o autor das candidaturas e responde pela veracidade dos dados e pelos aceites que fizer.",
    more: "Não garantimos emprego, entrevista ou resposta. Respondemos pelas falhas comprovadas do próprio serviço.",
  },
]

export const riskById = (id: RiskId): Risk =>
  RISK_CATALOG.find((r) => r.id === id)!

/** Terms / privacy / marketing / consent checkboxes: never ticked by the automation. */
const CONSENT_LABEL =
  /(termo|terms|condi[cç][oõ]es de uso|privacidade|privacy|pol[ií]tica|consent|aceito|concordo|\bagree|\baccept|marketing|newsletter|comunica[cç][oõ]es|ofertas|novidades|lgpd|dados pessoais|personal data|autorizo|declaro)/i

export function isConsentLabel(label: string | null | undefined): boolean {
  return CONSENT_LABEL.test(label ?? "")
}

export type SiteRiskLevel = "baixo" | "medio" | "alto"

/** Most specific match of a host in the admin-managed list (exact domain or parent domain). */
export function siteRiskLevel(
  host: string,
  levels: readonly { domain: string; level: SiteRiskLevel }[]
): SiteRiskLevel | null {
  const h = host.toLowerCase()
  let best: { domain: string; level: SiteRiskLevel } | null = null
  for (const entry of levels) {
    const d = entry.domain.toLowerCase().replace(/^\./, "")
    if (
      (h === d || h.endsWith(`.${d}`)) &&
      (!best || d.length > best.domain.length)
    )
      best = { ...entry, domain: d }
  }
  return best?.level ?? null
}

/**
 * Low-confidence review fields: free-text/open questions, long answers or salary/availability
 * claims, which a resolver or the AI may have filled from a loose match.
 */
export function isLowConfidenceField(field: {
  label: string
  value: string
}): boolean {
  const label = field.label.trim()
  return (
    /\?\s*$/.test(label) ||
    label.length > 70 ||
    field.value.length > 200 ||
    /(pretens[aã]o|sal[aá]ri|disponibilidade|quando pode|por que|why|descreva|conte|experi[eê]ncia com)/i.test(
      label
    )
  )
}

export type AlertContext = {
  siteLevel?: SiteRiskLevel | null
  creatingAccount?: boolean
  consentPending?: boolean
  lowConfidence?: number
  recipeStatus?: string | null
  readingEmail?: boolean
  atReview?: boolean
  /** Shown before any search/apply/login that drives a browser. */
  browserProvider?: "local" | "browserbase"
}

export type RiskAlert = Risk & { detail?: string }

/** Which alerts to show at this moment of the journey. */
export function riskAlerts(ctx: AlertContext): RiskAlert[] {
  const out: RiskAlert[] = []
  if (ctx.browserProvider)
    out.push({
      ...riskById("navegador_local"),
      detail:
        ctx.browserProvider === "local"
          ? "Esta execução vai usar o seu Chrome local, nas suas contas reais. Você assume o risco de bloqueio."
          : "Esta execução vai usar um navegador na nuvem (Browserbase). Também pode haver bloqueio; você assume o risco.",
    })
  if (ctx.siteLevel === "alto" || ctx.siteLevel === "medio")
    out.push({
      ...riskById("sites_bloqueiam_bots"),
      detail:
        ctx.siteLevel === "alto"
          ? "Este site é conhecido por restringir automação."
          : "Este site pode restringir automação.",
    })
  if (ctx.consentPending) out.push(riskById("termos_de_sites"))
  if (ctx.creatingAccount) out.push(riskById("contas_e_senhas"))
  if (ctx.readingEmail) out.push(riskById("email_e_links"))
  if (ctx.recipeStatus && ctx.recipeStatus !== "trusted")
    out.push({
      ...riskById("receita_desatualizada"),
      detail:
        ctx.recipeStatus === "stale" || ctx.recipeStatus === "relearning"
          ? "A receita deste site está desatualizada e está sendo reaprendida."
          : "A receita deste site ainda não é confiável.",
    })
  if (ctx.lowConfidence && ctx.lowConfidence > 0)
    out.push({
      ...riskById("erros_ia"),
      detail: `${ctx.lowConfidence} resposta(s) de baixa confiança destacada(s) abaixo.`,
    })
  if (ctx.atReview) out.push(riskById("responsabilidade"))
  return out
}
