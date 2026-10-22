/**
 * Rule-based intent parsing for chat settings (spec F14, `parseSettingsIntent` and
 * `parseSearchRequest`). Used by the FAKE orchestrator (tests, CI, local dev without a key)
 * and by the settings-intent eval. With a real model the orchestrator does function calling
 * itself; the server validates every call either way.
 */
import { extractUrls } from "@vagapilot/core/guardrails"
import {
  inferSeniority,
  type LanguageLevel,
  type Seniority,
  type WorkModel,
} from "@vagapilot/core/job-rules"
import type { ChatToolName } from "@vagapilot/core/policy"
import type { SearchFrequency, TimeOfDay } from "@vagapilot/core/settings"

import type { ChatToolInput } from "./tool-schemas.js"

export type IntentCall = {
  [K in ChatToolName]: { tool: K; input: ChatToolInput<K> }
}[ChatToolName]

/** Lowercase, accent-free copy with the same length, so indices map back to the original. */
export function foldKeepLength(text: string): string {
  let out = ""
  for (const char of text) {
    const folded = char
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
    out +=
      folded.length === char.length
        ? folded
        : char.toLowerCase().slice(0, char.length).padEnd(char.length, " ")
  }
  return out
}

function clean(value: string): string {
  return value
    .replace(/\b(por favor|pfv|pf|obrigad[oa])\b/gi, "")
    .replace(/^[\s,:;-]+|[\s,.;:!?-]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

const SENIORITY_WORDS: [RegExp, Seniority][] = [
  [/^(estagiari[oa]s?|estagio)$/, "estagio"],
  [/^(junior|jr)$/, "junior"],
  [/^pleno$/, "pleno"],
  [/^(senior|sr)$/, "senior"],
  [/^especialistas?$/, "especialista"],
  [/^(coordenador(a|es)?|coordenacao)$/, "coordenador"],
  [/^(gerente|gerentes|gerencia)$/, "gerente"],
  [/^head$/, "head"],
  [/^(diretor(a|es)?|diretoria)$/, "diretor"],
  [/^vp$/, "vp"],
  [/^(c-level|clevel)$/, "c_level"],
]

function seniorityWord(word: string): Seniority | null {
  return SENIORITY_WORDS.find(([pattern]) => pattern.test(word))?.[1] ?? null
}

const LEVEL_WORDS: Record<string, LanguageLevel> = {
  basico: "basico",
  intermediario: "intermediario",
  avancado: "avancado",
  fluente: "fluente",
  nativo: "nativo",
  a1: "basico",
  a2: "basico",
  b1: "intermediario",
  b2: "avancado",
  c1: "fluente",
  c2: "fluente",
}

const LANGUAGE_NAMES: Record<string, string> = {
  ingles: "Inglês",
  espanhol: "Espanhol",
  frances: "Francês",
  alemao: "Alemão",
  italiano: "Italiano",
}

/** "20k", "20 mil", "R$ 20.000", "25,5k" → number. */
export function parseAmountText(raw: string, suffix?: string): number | null {
  let normalized = raw.replace(/\s/g, "")
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(normalized))
    normalized = normalized.replace(/\./g, "").replace(",", ".")
  else normalized = normalized.replace(",", ".")
  const value = Number(normalized)
  if (!Number.isFinite(value) || value <= 0) return null
  return suffix && /^(k|mil)$/.test(suffix) ? Math.round(value * 1000) : value
}

const AMOUNT =
  /r?\$?\s*(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?)\s*(k|mil)?\b/

// ---------------------------------------------------------------------------
// Saved searches (parseSearchRequest)
// ---------------------------------------------------------------------------

const UF_CODES: Record<string, string> = {
  sp: "São Paulo",
  rj: "Rio de Janeiro",
  mg: "Minas Gerais",
  df: "Distrito Federal",
}

export type ParsedSearch = {
  query: string | null
  location: string | null
  ambiguousLocation: string | null
  workModel: WorkModel | null
  seniority: Seniority | null
  regime: "clt" | "pj" | "ambos" | null
  language: "pt-BR" | "en" | "es" | null
  salaryMin: number | null
  salaryMax: number | null
  postedWithinDays: number | null
  excludedCompanies: string[]
  frequency: SearchFrequency
  timeOfDay: TimeOfDay | null
}

const QUERY_STOP =
  /\s(em|no|na|nos|nas|para trabalhar|com salario|acima|a partir|entre|ate|sem|exceto|menos|toda|todo|todos|diari|semanal|dias uteis|publicad|nos ultimos|remot|hibrid|presencial|clt|pj|em ingles|em espanhol|de manha|a tarde|a noite|por favor)\b|[,.;!?]/

function workModelIn(folded: string): WorkModel | null {
  if (/\bhibrid[oa]s?\b|\bhybrid\b/.test(folded)) return "hibrido"
  if (/\bremot[oa]s?\b|\bremote\b|home office/.test(folded)) return "remoto"
  if (/\bpresencia(l|is)\b|\bon-?site\b/.test(folded)) return "presencial"
  return null
}

function frequencyIn(folded: string): {
  frequency: SearchFrequency
  timeOfDay: TimeOfDay | null
} {
  const timeOfDay: TimeOfDay | null = /\bmanha\b/.test(folded)
    ? "manha"
    : /\btarde\b/.test(folded)
      ? "tarde"
      : /\bnoite\b/.test(folded)
        ? "noite"
        : null
  if (/dias uteis|segunda a sexta/.test(folded))
    return { frequency: "dias_uteis", timeOfDay }
  if (
    /\b(toda semana|semanal|semanalmente|uma vez por semana|toda segunda|toda sexta)\b/.test(
      folded
    )
  ) {
    return { frequency: "semanal", timeOfDay }
  }
  return { frequency: "diaria", timeOfDay }
}

/** Filters from a natural sentence ("quero vagas de gerente de TI em SP, híbrido, toda manhã"). */
export function parseSearchRequest(text: string): ParsedSearch {
  const folded = foldKeepLength(text)
  let query: string | null = null
  const start =
    /\bvagas?\s+(?:(?:remot|hibrid|presencia)\w*\s+)?(?:de|para|como|na area de)?\s*/.exec(
      folded
    ) ?? /\b(?:busca|alerta|buscas)\s+(?:de|por|para)\s+/.exec(folded)
  if (start) {
    const from = start.index + start[0].length
    const rest = folded.slice(from)
    const stop = QUERY_STOP.exec(` ${rest}`)
    const end = stop ? from + Math.max(0, stop.index - 1) : text.length
    query = clean(text.slice(from, end)) || null
  }

  let location: string | null = null
  let ambiguousLocation: string | null = null
  const locationMatch =
    /\s(?:em|no|na)\s+(?!ingles|espanhol|empresas?\b|dias\b|regime\b)([^,.;!?]+)/.exec(
      folded
    )
  if (locationMatch?.[1]) {
    const from =
      (locationMatch.index ?? 0) +
      locationMatch[0].length -
      locationMatch[1].length
    const raw = text.slice(from, from + locationMatch[1].length)
    const cut =
      /\s(remot|hibrid|presencial|toda|todo|todos|diari|semanal|sem\s|exceto|clt|pj|de manha|a tarde|a noite|acima|com salario|publicad)/.exec(
        foldKeepLength(raw)
      )
    const value = clean(cut ? raw.slice(0, cut.index) : raw)
    const code = foldKeepLength(value).trim()
    if (UF_CODES[code]) ambiguousLocation = value.toUpperCase()
    else if (value) location = value
  }

  const excludedCompanies: string[] = []
  for (const match of folded.matchAll(
    /\b(?:sem|exceto|menos|fora)\s+(?:a\s+|o\s+)?(?:empresa\s+)(.+?)(?=,|;|\.|\s+e\s+|\s+toda|\s+todo|$)/g
  )) {
    const index = (match.index ?? 0) + match[0].length - (match[1]?.length ?? 0)
    const name = clean(text.slice(index, index + (match[1]?.length ?? 0)))
    if (name) excludedCompanies.push(name)
  }

  let salaryMin: number | null = null
  let salaryMax: number | null = null
  const range =
    /\b(?:entre|de)\s+r?\$?\s*(\d+(?:[.,]\d+)?)\s*(k|mil)?\s+(?:e|a|ate)\s+r?\$?\s*(\d+(?:[.,]\d+)?)\s*(k|mil)?/.exec(
      folded
    )
  if (
    range?.[1] &&
    range[3] &&
    /salari|faixa|pagando|remunera|r\$|\bk\b|mil/.test(folded)
  ) {
    salaryMin = parseAmountText(range[1], range[2] ?? range[4])
    salaryMax = parseAmountText(range[3], range[4])
  } else {
    const above =
      /\b(?:acima de|a partir de|minimo de|pelo menos)\s+r?\$?\s*(\d+(?:[.,]\d+)?)\s*(k|mil)?/.exec(
        folded
      )
    if (above?.[1]) salaryMin = parseAmountText(above[1], above[2])
  }

  const days =
    /\b(?:ultim[oa]s?|nos ultimos|nas ultimas)\s+(\d{1,2})\s+dias\b/.exec(
      folded
    )
  const postedWithinDays = days?.[1]
    ? Number(days[1])
    : /\b(ultima semana|desta semana)\b/.test(folded)
      ? 7
      : /\b(hoje|ultimas 24 ?h)\b/.test(folded)
        ? 1
        : null

  const clt = /\bclt\b/.test(folded)
  const pj = /\bpj\b/.test(folded)
  const { frequency, timeOfDay } = frequencyIn(folded)
  return {
    query,
    location,
    ambiguousLocation,
    workModel: workModelIn(folded),
    seniority: query ? inferSeniority(query) : null,
    regime: clt && pj ? "ambos" : clt ? "clt" : pj ? "pj" : null,
    language: /\bem ingles\b|\bin english\b/.test(folded)
      ? "en"
      : /\bem espanhol\b/.test(folded)
        ? "es"
        : null,
    salaryMin,
    salaryMax,
    postedWithinDays,
    excludedCompanies,
    frequency,
    timeOfDay,
  }
}

const SEARCH_TRIGGER =
  /\b(quero|queria|gostaria de|busque|procure|buscar|procurar|me (mande|envie|avise|mostre|traga)|crie|cria|criar|salve|monitore|ative|ativar|configure)\b[^.]*\b(vagas?|busca|alerta)\b|\b(nova busca|alerta de vagas?|busca de vagas?)\b/

function searchCall(parsed: ParsedSearch): IntentCall | null {
  if (!parsed.query) {
    return {
      tool: "ask_clarification",
      input: {
        question: "Qual cargo ou palavra-chave devo buscar?",
        options: [
          "Gerente de Engenharia",
          "Coordenador de TI",
          "Head de Tecnologia",
        ],
      },
    }
  }
  if (parsed.ambiguousLocation) {
    const name =
      UF_CODES[parsed.ambiguousLocation.toLowerCase()] ??
      parsed.ambiguousLocation
    return {
      tool: "ask_clarification",
      input: {
        question: `"${parsed.ambiguousLocation}" é a cidade ou o estado?`,
        options: [`${name} (cidade)`, `Estado de ${name}`],
      },
    }
  }
  if (!parsed.location && parsed.workModel !== "remoto") {
    return {
      tool: "ask_clarification",
      input: {
        question: "Em qual local? Se for remoto, escolha Remoto.",
        options: ["Remoto", "São Paulo", "Rio de Janeiro", "Belo Horizonte"],
      },
    }
  }
  return {
    tool: "create_saved_search",
    input: {
      query: parsed.query,
      ...(parsed.seniority ? { seniority: parsed.seniority } : {}),
      ...(parsed.location ? { location: parsed.location } : {}),
      ...(parsed.workModel ? { workModel: parsed.workModel } : {}),
      ...(parsed.regime ? { regime: parsed.regime } : {}),
      ...(parsed.language ? { language: parsed.language } : {}),
      ...(parsed.salaryMin !== null ? { salaryMin: parsed.salaryMin } : {}),
      ...(parsed.salaryMax !== null ? { salaryMax: parsed.salaryMax } : {}),
      ...(parsed.postedWithinDays !== null
        ? { postedWithinDays: parsed.postedWithinDays }
        : {}),
      ...(parsed.excludedCompanies.length > 0
        ? { excludedCompanies: parsed.excludedCompanies }
        : {}),
      frequency: parsed.frequency,
      ...(parsed.timeOfDay ? { timeOfDay: parsed.timeOfDay } : {}),
    },
  }
}

// ---------------------------------------------------------------------------
// Other settings intents
// ---------------------------------------------------------------------------

function companyAfter(
  text: string,
  folded: string,
  pattern: RegExp
): string | null {
  const match = new RegExp(
    pattern.source,
    `${pattern.flags.replace("d", "")}d`
  ).exec(folded)
  const span = match?.indices?.[1]
  if (!match?.[1] || !span) return null
  let start = span[0]
  const before = text.slice(Math.max(0, start - 8), start)
  if (/Empresa\s+$/.test(before)) start = text.lastIndexOf("Empresa", start)
  const raw = text.slice(start, span[1])
  const value = clean(
    raw.replace(
      /\s+(das|da|de|nas|nos)\s+(minhas\s+)?(vagas|buscas|lista).*$/i,
      ""
    )
  )
  return value || null
}

function salaryRules(
  folded: string
): ChatToolInput<"set_salary_rules">["rules"] {
  if (
    !/(pretens|\bpec[ao]\b|\bpedir\b|\bcobrar\b|\bcobre\b|minha remunera|meu salario|quero ganhar)/.test(
      folded
    )
  )
    return []
  const rules: ChatToolInput<"set_salary_rules">["rules"] = []
  let lastSeniority: Seniority | null = null
  for (const segment of folded.split(/,|;|\s+e\s+(?=\D*\d)/)) {
    const words = segment.split(/[^a-z0-9-]+/).filter(Boolean)
    const seniority =
      words
        .map(seniorityWord)
        .find((value): value is Seniority => value !== null) ?? null
    const regime = words.includes("pj")
      ? "pj"
      : words.includes("clt")
        ? "clt"
        : undefined
    const amountMatch = AMOUNT.exec(segment)
    if (!amountMatch?.[1]) {
      if (seniority) lastSeniority = seniority
      continue
    }
    const amount = parseAmountText(amountMatch[1], amountMatch[2])
    const target: Seniority | null = seniority ?? lastSeniority
    if (target) lastSeniority = target
    if (!amount || !target || amount < 500) continue
    rules.push({ seniority: target, ...(regime ? { regime } : {}), amount })
  }
  return rules
}

function languageLevel(
  folded: string
): ChatToolInput<"update_language_level"> | null {
  const patterns = [
    /\b(ingles|espanhol|frances|alemao|italiano)\s+(?:agora\s+)?(?:e|esta|ficou|virou|passou a ser|subiu para|foi para|:)?\s*(?:o\s+)?(?:nivel\s+)?(basico|intermediario|avancado|fluente|nativo|a1|a2|b1|b2|c1|c2)\b/,
    /\b(?:atualize|atualiza|mude|muda|altere|altera|coloque|coloca|ponha)\s+(?:o\s+)?(?:meu\s+)?(?:nivel\s+(?:de\s+)?)?(ingles|espanhol|frances|alemao|italiano)\s+(?:para|como|pra)\s+(basico|intermediario|avancado|fluente|nativo|a1|a2|b1|b2|c1|c2)\b/,
    /\b(?:tenho|falo)\s+(ingles|espanhol|frances|alemao|italiano)\s+(basico|intermediario|avancado|fluente|nativo|a1|a2|b1|b2|c1|c2)\b/,
    /\bnivel de (ingles|espanhol|frances|alemao|italiano)\s*(?:e|:|agora e)?\s*(basico|intermediario|avancado|fluente|nativo|a1|a2|b1|b2|c1|c2)\b/,
  ]
  for (const pattern of patterns) {
    const match = pattern.exec(folded)
    const language = match?.[1] ? LANGUAGE_NAMES[match[1]] : undefined
    const level = match?.[2] ? LEVEL_WORDS[match[2]] : undefined
    if (language && level) return { language, level }
  }
  return null
}

const KNOWN_TOOLS =
  /\b(kubernetes|terraform|aws|azure|gcp|python|go|golang|java|typescript|react|postgresql|kafka|spark|dbt|airflow|docker|sap|salesforce|power bi|excel|sql)\b/

function proposedFact(
  text: string,
  folded: string
): ChatToolInput<"propose_fact"> | null {
  if (/\?\s*$/.test(text)) return null
  if (
    !/\b(trabalhei|atuei|tenho experiencia|liderei|lidero|implementei|sou certificad[oa]|tenho (a )?certificacao|me certifiquei|conclui (o|a|um|uma)|gerenciei|gerencio)\b/.test(
      folded
    )
  ) {
    return null
  }
  const statement = clean(text).slice(0, 500)
  if (statement.length < 5) return null
  const kind = /certific/.test(folded)
    ? "certificacao"
    : KNOWN_TOOLS.test(folded)
      ? "ferramenta"
      : "competencia"
  return { statement, kind }
}

/**
 * Settings intents in a pt-BR sentence (RF14.1/RF14.2: one request can carry several).
 * Ambiguity becomes `ask_clarification`, never a silent guess (RF14.4).
 */
export function parseSettingsIntent(text: string): IntentCall[] {
  const folded = foldKeepLength(text)
  if (extractUrls(text).length > 0) return []
  const calls: IntentCall[] = []

  if (
    /\b(desfaca|desfaz|desfazer|reverta|reverter|volte atras|cancele a ultima)\b/.test(
      folded
    )
  ) {
    calls.push({ tool: "undo_change", input: {} })
    return calls
  }

  if (
    /\b(apague|apaga|exclua|exclui|remova|remove|delete|deleta|cancele|cancela)\b[^.]*\bbusca/.test(
      folded
    )
  ) {
    const match = /\bbusca(?:\s+salva)?\s+(?:de|por|para|da|do)?\s*(.+)$/.exec(
      folded
    )
    const index = match
      ? (match.index ?? 0) + match[0].length - (match[1]?.length ?? 0)
      : -1
    const value = match?.[1]
      ? clean(text.slice(index, index + match[1].length))
      : ""
    calls.push({
      tool: "delete_saved_search",
      input: value ? { match: value } : {},
    })
    return calls
  }

  if (
    /\b(mude|muda|altere|altera|troque|troca|atualize|atualiza|edite|edita)\b[^.]*\bbusca\b/.test(
      folded
    )
  ) {
    const match =
      /\bbusca\s+(?:de|por|para)?\s*(.+?)\s+(?:para|pra)\s+(.+)$/.exec(folded)
    if (match?.[1] && match[2]) {
      const index = (match.index ?? 0) + match[0].indexOf(match[1])
      const name = clean(text.slice(index, index + match[1].length))
      const changesText = match[2]
      const parsed = parseSearchRequest(`vagas ${changesText}`)
      const changes: ChatToolInput<"update_saved_search">["changes"] = {}
      const model = workModelIn(changesText)
      if (model) changes.workModel = model
      if (
        /\b(diari|toda manha|todo dia|semanal|toda semana|dias uteis)/.test(
          changesText
        )
      ) {
        changes.frequency = parsed.frequency
        if (parsed.timeOfDay) changes.timeOfDay = parsed.timeOfDay
      }
      const level = changesText.split(/\s+/).map(seniorityWord).find(Boolean)
      if (level) changes.seniority = level
      if (Object.keys(changes).length > 0) {
        calls.push({
          tool: "update_saved_search",
          input: { match: name, changes },
        })
        return calls
      }
    }
  }

  const removeCompany =
    companyAfter(
      text,
      folded,
      /\b(?:volte a (?:me )?mostrar|pode (?:voltar a )?mostrar|desbloqueie|desbloquear)\s+(?:vagas?\s+)?(?:d[aoe]\s+)?(?:a\s+|o\s+)?(?:empresa\s+)?(.+)$/
    ) ??
    companyAfter(
      text,
      folded,
      /\b(?:tire|remova|retire|tira)\s+(?:a\s+)?(?:empresa\s+)?(.+?)\s+da lista de (?:empresas\s+)?(?:exclu|bloque)/
    )
  if (removeCompany) {
    calls.push({
      tool: "remove_excluded_company",
      input: { company: removeCompany },
    })
    return calls
  }

  const addCompany =
    companyAfter(
      text,
      folded,
      /\bnao quero (?:mais\s+)?(?:ver\s+)?(?:receber\s+)?vagas?\s+(?:d[aoe]|na|no)\s+(?:empresa\s+)?(.+)$/
    ) ??
    companyAfter(
      text,
      folded,
      /\b(?:exclua|exclui|excluir|bloqueie|bloquear|bloqueia|remova|ignore|ignora)\s+(?:a\s+|o\s+)?(?:empresa\s+)?(.+?)\s+(?:das?|de)\s+(?:minhas\s+|todas as\s+)?(?:vagas|buscas)/
    ) ??
    companyAfter(text, folded, /\bsem vagas\s+d[aoe]\s+(?:empresa\s+)?(.+)$/)
  if (
    addCompany &&
    !SEARCH_TRIGGER.test(folded.replace(/nao quero (mais )?vagas/, ""))
  ) {
    calls.push({ tool: "add_excluded_company", input: { company: addCompany } })
  }

  const language = languageLevel(folded)
  if (language) calls.push({ tool: "update_language_level", input: language })

  const rules = salaryRules(folded)
  if (rules.length > 0)
    calls.push({ tool: "set_salary_rules", input: { rules } })

  if (
    /\b(nao|sem)\s+(cite|cita|citar|mencione|menciona|mencionar|coloque|coloca|inclua|inclui|incluir|informe|fale|falar|coloque a)\b[^.]*\b(pretensao|salario)\b[^.]*\be-?mails?\b|\bsem (a )?pretensao (salarial )?n[oa]s? e-?mails?/.test(
      folded
    )
  ) {
    calls.push({
      tool: "set_preference",
      input: { key: "email.include_salary", value: false },
    })
  } else if (
    /\b(pode|podem)?\s*(cite|cita|citar|mencione|mencionar|inclua|incluir|informe)\b[^.]*\b(pretensao|salario)\b[^.]*\be-?mails?\b/.test(
      folded
    )
  ) {
    calls.push({
      tool: "set_preference",
      input: { key: "email.include_salary", value: true },
    })
  }
  const minFit =
    /\b(so|apenas|somente)\b[^.]*\bvagas\b[^.]*\bfit\s+(alto|medio)\b/.exec(
      folded
    )
  if (minFit?.[2]) {
    calls.push({
      tool: "set_preference",
      input: {
        key: "searches.min_fit",
        value: minFit[2] === "alto" ? "alto" : "medio",
      },
    })
  }

  if (
    /\b(envie direto|enviar direto|envia direto|pode enviar sem (me )?perguntar|sem pausar antes)\b/.test(
      folded
    ) &&
    !/\bnao\s+(envie|enviar|envia)\s+direto\b/.test(folded)
  ) {
    calls.push({
      tool: "set_approval_mode",
      input: { mode: "envie_direto", scope: "padrao" },
    })
  } else if (
    /\b(pause antes|pausar antes|pausa antes|sempre (me )?pergunte antes|me pergunte antes de enviar|nao envie direto)\b/.test(
      folded
    )
  ) {
    calls.push({
      tool: "set_approval_mode",
      input: { mode: "pausar_antes", scope: "padrao" },
    })
  }

  const fact = proposedFact(text, folded)
  if (fact && calls.length === 0)
    calls.push({ tool: "propose_fact", input: fact })

  if (calls.length === 0 && SEARCH_TRIGGER.test(folded)) {
    const call = searchCall(parseSearchRequest(text))
    if (call) calls.push(call)
  }

  if (
    calls.length === 0 &&
    /\b(o que|quais|quantas|quantos)\b[^.]*\b(pendente|pendencias|acoes|tarefas|candidaturas|enviei|falta)\b|\bminhas (acoes|tarefas|pendencias)\b|\bo que (eu )?tenho (pra|para) fazer\b/.test(
      folded
    )
  ) {
    calls.push({ tool: "list_pending_actions", input: {} })
  }

  if (
    calls.length === 0 &&
    /\b(quais|minhas|mostre|liste|ver)\b[^.]*\b(configurac\w*|preferencias|buscas salvas|empresas excluidas|minhas buscas)\b|\bo que voce sabe sobre (mim|minhas preferencias)\b/.test(
      folded
    )
  ) {
    calls.push({ tool: "get_settings", input: {} })
  }

  return calls
}

/**
 * Answers to a previous `ask_clarification` (location ambiguity) are merged back into the
 * original request so the FAKE orchestrator can finish it.
 */
export function mergeClarification(
  previousRequest: string,
  question: string,
  answer: string
): string {
  const folded = foldKeepLength(answer).trim()
  if (/^remot/.test(folded)) return `${previousRequest} remoto`
  const ambiguous = /^"([A-Za-z]{2})"/.exec(question)?.[1]
  const city = /^(.+?)\s*\(cidade\)$/.exec(answer.trim())?.[1]
  if (ambiguous) {
    const replacement = city ?? answer.trim()
    return previousRequest.replace(
      new RegExp(`\\b${ambiguous}\\b`, "i"),
      replacement
    )
  }
  if (/qual cargo/i.test(question))
    return previousRequest.replace(/\bvagas?\b/i, `vagas de ${answer.trim()}`)
  return `${previousRequest} em ${answer.trim()}`
}
