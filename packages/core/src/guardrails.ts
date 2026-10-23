/**
 * Chat guardrails that do not need a model (spec 10.4, F14 "Guardrails e segurança do chat"):
 * input limits, link extraction, rate-limit window, rule-based topic classification,
 * injection markers and the output filter. Pure: no I/O.
 */

import { isValidCpf } from "./redact.js"

export const MAX_CHAT_INPUT_CHARS = 8_000
export const MAX_LINKS_PER_BATCH = 20
export const CHAT_MESSAGES_PER_MINUTE = 20
export const RATE_LIMIT_WINDOW_MS = 60_000

function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
}

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi

/** URLs pasted in a message (one per line or mixed in text, RF4.1), deduplicated, in order. */
export function extractUrls(text: string): string[] {
  const seen = new Set<string>()
  const urls: string[] = []
  for (const match of text.matchAll(URL_RE)) {
    let url = match[0].replace(/[).,;:!?\]}>]+$/, "")
    if (url.toLowerCase().startsWith("www.")) url = `https://${url}`
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue
      const key = parsed.toString()
      if (seen.has(key)) continue
      seen.add(key)
      urls.push(key)
    } catch {
      continue
    }
  }
  return urls
}

/** Sliding window: true when `limit` messages already happened within the window. */
export function isRateLimited(
  recentTimestamps: readonly number[],
  now: number,
  limit: number = CHAT_MESSAGES_PER_MINUTE,
  windowMs: number = RATE_LIMIT_WINDOW_MS
): boolean {
  return recentTimestamps.filter((at) => now - at < windowMs).length >= limit
}

// ---------------------------------------------------------------------------
// Topic classification by rules (layer (a) before the orchestrator)
// ---------------------------------------------------------------------------

export type TopicVerdict =
  | "in_scope"
  | "off_topic"
  | "injection"
  | "prompt_leak"
  | "fraud"
  | "discriminatory"
  | "unknown"

const INJECTION_PATTERNS: readonly RegExp[] = [
  /ignor(e|a|ar|em)\s+(todas\s+)?(as\s+|suas\s+)?(instrucoes|regras|orientacoes)(\s+\w+){0,2}\s+(anteriores|acima|previas|do sistema)/,
  /ignore\s+(all\s+)?(the\s+|your\s+)?(previous|prior|above)\s+(instructions|rules)/,
  /\bignor(e|a|ar|em)\s+(todas\s+)?(as\s+|suas\s+|tuas\s+|essas\s+)?(instrucoes|regras|orientacoes|restricoes|diretrizes)\b/,
  /\b(me\s+)?(passe|passa|mande|manda|envie|envia|diga|diz|revele|revela|informe|mostre|mostra)\s+(me\s+)?(a|as|o|os|sua|suas|seu|seus|uma)?\s*(senha|senhas|password|token|tokens|chave de api|api key|credencia\w*|segredo|segredos)\b/,
  /\bme\s+(de|da)\s+(a\s+|sua\s+|o\s+|seu\s+)?(senha|password|token|chave de api|api key|credencia\w*)\b/,
  /\b(give|send|tell|show)\s+me\s+(the|your)\s+(password|token|api key|credentials|secrets?)\b/,
  /desconsider(e|a)\s+(as\s+)?(instrucoes|regras)/,
  /disregard\s+(all\s+)?(previous|prior|the)\s+/,
  /\byou are now\b/,
  /\bvoce agora e\b/,
  /\bmodo (desenvolvedor|developer|deus|sem restricoes)\b/,
  /\bdeveloper mode\b/,
  /\bjailbreak\b/,
  /\bdan mode\b/,
  /<\/?\s*(system|sistema|instructions?)\s*>/,
  /#{2,}\s*(system|sistema)\b/,
  /\[(system|sistema)\]/,
  /\bnova(s)? instruc(ao|oes) (do|de) sistema\b/,
  /\bnew system (prompt|instructions?)\b/,
  /\boverride (your|the) (rules|instructions|policy)\b/,
]

const PROMPT_LEAK_PATTERNS: readonly RegExp[] = [
  /(mostre|mostra|revele|revela|repita|repete|imprima|exiba|copie|cole|escreva|liste|diga|conte)\s+(o\s+|a\s+|as\s+|os\s+|seu\s+|sua\s+|suas\s+|seus\s+)?(seu\s+|sua\s+)?(prompt|instrucoes|instrucao|regras internas|configuracao interna|mensagem de sistema|system)/,
  /(show|reveal|print|repeat|output|display|tell me)\s+(me\s+)?(your|the)\s+(system\s+)?(prompt|instructions|rules)/,
  /qual (e )?(o )?seu prompt/,
  /quais sao (as )?suas instrucoes/,
  /\bsystem prompt\b/,
  /\bprompt (de|do) sistema\b/,
  /texto (inicial|acima) (da|desta) conversa/,
]

const FRAUD_PATTERNS: readonly RegExp[] = [
  /(falsific|forj|adulter)\w*/,
  /(diploma|certificad\w*|certificacao|referencia\w*|holerite|contracheque|carteira de trabalho|atestado|historico escolar)\s+(falso|falsa|falsos|falsas|fake|forjad\w*)/,
  /(fake|falso|falsa)\s+(diploma|certificad\w*|referencia\w*|experiencia)/,
  /(inventar|invente|inventa|fabricar|fabrique)\s+(uma\s+|um\s+)?(experiencia|empresa|cargo|referencia|certificacao|diploma|formacao)/,
  /(mentir|minta|mente|enganar|engane)\s+(no|na|para|pro|pra|ao|a)\s+(curriculo|cv|entrevista|recrutador|empresa|formulario)/,
  /\bcomo mentir\b/,
  /(experiencia|certificacao|formacao|diploma)\s+que\s+(eu\s+)?nao\s+tenho/,
  /\bfake (degree|certificate|reference|experience)\b/,
  /\blie (on|in) (my )?(resume|cv|interview)\b/,
]

const PROTECTED_GROUPS =
  /(mulher|mulheres|homem|homens|negr[oa]s?|pret[oa]s?|brancos?|brancas?|gays?|lgbt\w*|trans\b|idos[oa]s?|velh[oa]s?|jovens|gravidas?|gestantes?|deficien\w*|pcds?\b|religios\w*|evangelic\w*|catolic\w*|judeus?|muculman\w*|estrangeir\w*|nordestin\w*|indigenas?|acima de \d+ anos|mais de \d+ anos|com filhos|maes?\b)/
const EXCLUSION_VERBS =
  /(sem|nao (quero|aceito|contrat\w*|trabalh\w*)|exclu\w*|evit\w*|so (com|de|para)|somente|apenas|filtr\w*|tir\w* (as|os)|remov\w*|barr\w*|que nao tenham?|que nao seja)/

const DOMAIN_TERMS =
  /\b(vagas?|emprego|empregos|trabalho|cargo|cargos|carreira|curriculos?|cvs?|candidat\w*|entrevistas?|recrutador\w*|recrutamento|seletivo|salario|salarial|pretensao|remuneracao|clt|pj|empresas?|linkedin|gupy|greenhouse|lever|workday|inhire|quickin|jobbol|solides|successfactors|ats|fit|aderencia|buscas?|busque|alertas?|filtros?|remoto|remota|hibrido|hibrida|presencial|ingles|espanhol|idiomas?|nivel|fatos?|experiencias?|competencias?|habilidades?|certificac\w*|perfil|configurac\w*|preferencias?|memoria|desfaz\w*|relatorio|planilha|controle|tracker|pendentes?|pendencias?|prazos?|status|aplicar|aplique|pular|pule|salvar|gerente|coordenador\w*|diretor\w*|head|engenheir\w*|analista|desenvolvedor\w*|oferta|proposta|admissao|recrutadora|rh|onboarding|pausar|pause|envie direto|bloque\w*|excluid\w*|trilha|portfolio|job|jobs|resume|interview|salary|hiring|apply|recruiter|candidatei|candidatura|candidaturas|processo|processos|etapa|teste|enviei|enviadas?|exporta\w*|e-?mails?|rascunho|aprovac\w*|tarefas?|suas acoes)\b/

/** Off-topic even when a domain word shows up ("trabalho escolar", "receita de bolo"). */
const STRONG_OFF_TOPIC =
  /\b(receitas? (de|para|com)|bolo|piadas?|poemas?|poesia|horoscopo|signo d|previsao do tempo|dever de casa|licao de casa|tarefa escolar|trabalho escolar|trabalho da escola|trabalho da faculdade|redacao escolar|redacao do enem|futebol|novela|tarot|astrologia|conte uma historia|charada|letra da musica|fofoca|escreva (um|uma) (codigo|programa|script|funcao|poema|historia|conto|musica)|(codigo|programa|script) em (python|javascript|java|c\+\+|sql))\b/

const OFF_TOPIC_TERMS =
  /\b(receitas?|cozinh\w*|culinaria|musicas?|cancao|campeonato|time do|jogo do|filmes?|series?|signo|clima (de|em|hoje)|capital d[aoe]|quem (descobriu|inventou|foi)|historia d[aoe]|matematica|equacao|derivada|integral|resolva|prova de|traduz\w*|translate|python|javascript|typescript|java\b|sql|html|css|bitcoin|cripto\w*|bolsa de valores|investir|apostas?|namor\w*|relacionamento amoroso|remedios?|sintomas?|doenca|turismo|hotel|passagens? aereas?|roteiro de viagem|adivinha|xadrez|videogame|minecraft|fortnite|carro|motor|maquiagem|dieta|academia|treino de|politica|eleicao|presidente d[aoe]|celebridade)\b/

const SMALL_TALK =
  /^(oi|ola|ei|bom dia|boa tarde|boa noite|obrigad[oa]|valeu|tudo bem|ajuda|me ajuda|socorro|o que voce faz|como funciona|quem e voce|ok|beleza|entendi|sim|nao|pode|claro|cancelar|tchau)\b/

export type TopicClassification = { verdict: TopicVerdict; reason: string }

/** True when the text carries an instruction aimed at the assistant (spotlighting bypass). */
export function detectInjection(text: string): boolean {
  const folded = fold(text)
  return INJECTION_PATTERNS.some((pattern) => pattern.test(folded))
}

/**
 * Cheap rule-based layer before the orchestrator. "unknown" is left for a small model;
 * without one, callers treat it as in scope and the system prompt keeps the answer on topic.
 */
export function classifyTopicByRules(text: string): TopicClassification {
  const folded = fold(text).replace(/\s+/g, " ").trim()
  if (!folded) return { verdict: "unknown", reason: "empty" }
  if (PROMPT_LEAK_PATTERNS.some((pattern) => pattern.test(folded))) {
    return { verdict: "prompt_leak", reason: "prompt_leak_pattern" }
  }
  if (INJECTION_PATTERNS.some((pattern) => pattern.test(folded))) {
    return { verdict: "injection", reason: "injection_pattern" }
  }
  if (FRAUD_PATTERNS.some((pattern) => pattern.test(folded))) {
    return { verdict: "fraud", reason: "fraud_pattern" }
  }
  if (PROTECTED_GROUPS.test(folded) && EXCLUSION_VERBS.test(folded)) {
    return { verdict: "discriminatory", reason: "discriminatory_filter" }
  }
  if (extractUrls(text).length > 0)
    return { verdict: "in_scope", reason: "links" }
  if (STRONG_OFF_TOPIC.test(folded))
    return { verdict: "off_topic", reason: "off_topic_terms" }
  if (DOMAIN_TERMS.test(folded))
    return { verdict: "in_scope", reason: "domain_terms" }
  if (OFF_TOPIC_TERMS.test(folded))
    return { verdict: "off_topic", reason: "off_topic_terms" }
  if (SMALL_TALK.test(folded))
    return { verdict: "in_scope", reason: "small_talk" }
  return { verdict: "unknown", reason: "no_signal" }
}

/** Verdicts the chat refuses without calling the orchestrator. */
export function isRefusedVerdict(verdict: TopicVerdict): boolean {
  switch (verdict) {
    case "off_topic":
    case "injection":
    case "prompt_leak":
    case "fraud":
    case "discriminatory":
      return true
    case "in_scope":
    case "unknown":
      return false
    default: {
      const unreachable: never = verdict
      throw new Error(`Unknown verdict: ${String(unreachable)}`)
    }
  }
}

// ---------------------------------------------------------------------------
// Output filter (exfiltration, PII beyond what is needed, prompt leakage)
// ---------------------------------------------------------------------------

export const REMOVED_LINK = "[link removido]"
export const REMOVED_PII = "[dado removido]"

const OUTPUT_URL_RE = /\bhttps?:\/\/[^\s<>"'`)]+/gi
const OUTPUT_EMAIL_RE =
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g
const HAS_EMAIL_RE =
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/
const OUTPUT_CPF_RE = /(?<!\d)\d{3}\.\d{3}\.\d{3}-\d{2}(?!\d)/g
const OUTPUT_ELEVEN_RE = /(?<!\d)\d{11}(?!\d)/g
const OUTPUT_PHONE_RE =
  /(?<![\d+])(?:\+?55[\s.-]?)?\(?[1-9]{2}\)[\s.-]?(?:9\d{4}|[2-8]\d{3})[\s.-]?\d{4}(?!\d)|(?<![\d+])\+55[\s.-]?[1-9]{2}[\s.-]?(?:9\d{4}|[2-8]\d{3})[\s.-]?\d{4}(?!\d)/g

export type OutputFilterOptions = {
  /** Hosts that may appear in links (the app, job sources, the user's own job links). */
  allowedHosts: readonly string[]
  /** E-mails that may appear (e.g. the posting's application e-mail). */
  allowedEmails?: readonly string[]
  /** Fragments of the system prompt that must never be echoed. */
  promptFragments?: readonly string[]
}

export type OutputFilterResult = {
  text: string
  reasons: ("link" | "pii" | "prompt_leak")[]
}

function hostAllowed(host: string, allowed: readonly string[]): boolean {
  const normalized = host.toLowerCase().replace(/^www\./, "")
  return allowed.some((entry) => {
    const allowedHost = entry.toLowerCase().replace(/^www\./, "")
    return normalized === allowedHost || normalized.endsWith(`.${allowedHost}`)
  })
}

function carriesData(url: URL): boolean {
  let decoded = url.href
  try {
    decoded = decodeURIComponent(url.href)
  } catch {
    return true
  }
  return url.search.length > 1 || HAS_EMAIL_RE.test(decoded)
}

/**
 * Removes links to unknown hosts that carry data, PII the chat never needs to print and any
 * echo of the system prompt (in that case the whole answer is replaced by `refusal`).
 */
export function filterOutput(
  text: string,
  options: OutputFilterOptions,
  refusal: string
): OutputFilterResult {
  const reasons = new Set<OutputFilterResult["reasons"][number]>()
  const folded = fold(text)
  for (const fragment of options.promptFragments ?? []) {
    if (fragment.length >= 10 && folded.includes(fold(fragment))) {
      return { text: refusal, reasons: ["prompt_leak"] }
    }
  }

  let result = text.replace(OUTPUT_URL_RE, (raw) => {
    try {
      const url = new URL(raw)
      if (hostAllowed(url.hostname, options.allowedHosts) || !carriesData(url))
        return raw
    } catch {
      return raw
    }
    reasons.add("link")
    return REMOVED_LINK
  })

  const allowedEmails = new Set(
    (options.allowedEmails ?? []).map((email) => email.toLowerCase())
  )
  result = result
    .replace(OUTPUT_EMAIL_RE, (email) => {
      if (allowedEmails.has(email.toLowerCase())) return email
      reasons.add("pii")
      return REMOVED_PII
    })
    .replace(OUTPUT_CPF_RE, () => {
      reasons.add("pii")
      return REMOVED_PII
    })
    .replace(OUTPUT_ELEVEN_RE, (digits) => {
      if (!isValidCpf(digits)) return digits
      reasons.add("pii")
      return REMOVED_PII
    })
    .replace(OUTPUT_PHONE_RE, () => {
      reasons.add("pii")
      return REMOVED_PII
    })

  return { text: result, reasons: [...reasons] }
}
