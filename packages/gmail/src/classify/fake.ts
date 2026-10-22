/**
 * FAKE, DETERMINISTIC E-MAIL CLASSIFIER — tests, evals by default and local dev without an LLM.
 * Keyword rules in PT/EN plus the deterministic date parser of @vagapilot/core. It does not
 * understand language; real quality comes from the gateway model. Never use it in production.
 */
import { normalizeCompanyName } from "@vagapilot/core/blocklist"
import {
  isJobAlertSender,
  looksLikeVerificationCode,
  type ClassifierClass,
} from "@vagapilot/core/email"
import {
  parseDeadline,
  parseInterviewTime,
  toZonedIso,
} from "@vagapilot/core/email-dates"
import { MockLanguageModelV4 } from "ai/test"

import type { EmailClassificationOutput } from "./schema.js"

export const FAKE_CLASSIFIER_MODEL_ID = "vagapilot-fake-email-v1"

export type ClassifierInput = {
  fromAddress: string | null
  fromName: string | null
  subject: string
  body: string
  receivedAt: Date
  /** Companies with an application, to name the company when the e-mail mentions it. */
  knownCompanies?: readonly string[]
}

function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
}

const REJECTION =
  /infelizmente|nao (seguiremos|avancaremos|vamos (seguir|avancar|prosseguir))|nao (foi|fomos) (selecionad|aprovad)|optamos por (seguir|prosseguir|dar continuidade) com outr|decidimos (seguir|prosseguir|avancar) com outr|seguir com outros? (candidat|perfis)|unfortunately|not (be )?moving forward|decided (not )?to (move forward|proceed|continue) with other|will not be (moving|proceeding)|position has been filled|we have decided to pursue other/
const REJECTION_HEDGE =
  /no momento|neste momento|por enquanto|banco de talentos|futuras oportunidades|manteremos seu (curriculo|perfil)|at this time|future opportunities/
const INTERVIEW =
  /(convid\w*|agend\w*|marc\w*|disponibilidade)[^.\n]{0,60}(entrevista|conversa|bate-papo|papo)|(entrevista|conversa)[^.\n]{0,20}(agendad|marcad|confirmad)|invite you to (an? )?(interview|conversation|chat)|schedule (an? )?(interview|call|chat)|interview (invitation|invite|scheduled)|calendly\.com|meet\.google\.com|teams\.microsoft\.com/
const INTERVIEW_WEAK = /entrevista|interview/
const STAGE_WORD =
  /\b(teste|desafio|case|avaliacao|questionario|prova|assessment|challenge|coding|take-home|etapa|online test|hackerrank|codility)\b/
const STAGE_CALL =
  /(prazo|ate (o dia )?\d|data limite|deadline|due|by |until|complete|concluir|realizar|responder|finalizar|acesse o link|link abaixo|em ate \d|within \d)/
const CONFIRMATION =
  /recebemos (a )?sua (candidatura|inscricao|aplicacao)|candidatura (foi )?(recebida|realizada|enviada|confirmada|registrada)|inscricao (foi )?(recebida|confirmada|realizada)|obrigad[oa] (por|pela) (se candidatar|sua candidatura|candidatura|seu interesse)|agradecemos (seu interesse|sua candidatura)|thank you for (applying|your application|your interest)|thanks for applying|we (have )?received your application|application (has been )?(received|submitted)/
const RECRUITER =
  /(vi|encontrei|conheci) (o )?seu perfil|gostaria de (conversar|bater um papo|te apresentar)|tenho uma (oportunidade|vaga)|oportunidade que (pode|acho que)|came across your (profile|background)|reaching out|i am a recruiter|sou (recrutador|headhunter|tech recruiter)|headhunter|hunting/
const ALERT =
  /alerta de vaga|vagas recomendadas|novas vagas para (voce|o seu perfil)|job alert|jobs? (you may|recommended|for you)|new jobs (match|for you)|vagas que combinam/
const OTP_BODY =
  /codigo de (verificacao|acesso|seguranca)|verification code|one-time (pass)?code/

type Verdict = { class: ClassifierClass; confidence: number; why: string }

function decide(
  subject: string,
  text: string,
  fromAddress: string | null
): Verdict {
  const all = `${subject}\n${text}`
  if (looksLikeVerificationCode(subject) || OTP_BODY.test(all)) {
    return {
      class: "codigo_verificacao",
      confidence: 0.95,
      why: "verification code",
    }
  }
  if (isJobAlertSender(fromAddress) || ALERT.test(all)) {
    return { class: "vaga_alerta", confidence: 0.93, why: "job alert" }
  }

  const rejection = REJECTION.test(all)
  const interview = INTERVIEW.test(all)
  const stage = STAGE_WORD.test(all) && STAGE_CALL.test(all)
  const confirmation = CONFIRMATION.test(all)

  if (rejection) {
    const mixed = interview || stage || REJECTION_HEDGE.test(all)
    return {
      class: "reprovacao",
      confidence: mixed ? 0.62 : 0.93,
      why: "rejection wording",
    }
  }
  if (stage && !interview)
    return {
      class: "teste_etapa",
      confidence: 0.9,
      why: "test with call to action",
    }
  if (interview) {
    return {
      class: "convite_entrevista",
      confidence: stage ? 0.7 : 0.9,
      why: "interview invite",
    }
  }
  if (confirmation)
    return {
      class: "confirmacao",
      confidence: 0.92,
      why: "application received",
    }
  if (RECRUITER.test(all))
    return {
      class: "recrutador_contato",
      confidence: 0.85,
      why: "recruiter outreach",
    }
  if (STAGE_WORD.test(all))
    return { class: "teste_etapa", confidence: 0.6, why: "stage word only" }
  if (INTERVIEW_WEAK.test(all))
    return {
      class: "convite_entrevista",
      confidence: 0.6,
      why: "mentions interview",
    }
  return { class: "irrelevante", confidence: 0.75, why: "no recruiting signal" }
}

const COMPANY_IN_SENTENCE =
  /\b(?:na|da|pela|para a|à|a equipe d[ao]|time d[ao]|vaga d[ao]|at|from|with|join)\s+([A-Z][\p{L}\d&.\- ]{1,40}?)(?=[!,.|:;\n]| -| —| e | and |$)/u
/** "Empresa | assunto" or "Empresa: assunto" subjects. */
const COMPANY_PREFIX = /^([A-Z][\p{L}\d&.\- ]{1,40}?)\s*[|:]\s/u
const ROLE_PATTERNS = [
  /\b(?:vaga|posição|posicao|cargo) (?:de |para |: )?([\p{L}][\p{L}\d/&\- ]{2,60}?)(?=[!,.|:;\n(]| na | da | no | at | - |$)/u,
  /\bprocesso seletivo d[ao] [^\n.]{2,60}? para ([\p{L}][\p{L}\d/&\- ]{2,60}?)(?=[!,.|:;\n(]| - |$)/u,
  /\b(?:the|for) ([A-Z][\p{L}\d/&\- ]{2,60}?) (?:position|role|opening)\b/u,
]

function firstMatch(patterns: RegExp[], text: string): string | null {
  for (const pattern of patterns) {
    const value = pattern.exec(text)?.[1]?.trim()
    if (value) return value
  }
  return null
}

function findCompany(input: ClassifierInput, text: string): string | null {
  const haystack = ` ${fold(`${input.fromName ?? ""} ${input.subject} ${text}`).replace(/[^a-z0-9]+/g, " ")} `
  for (const company of input.knownCompanies ?? []) {
    const normalized = normalizeCompanyName(company)
    if (normalized && haystack.includes(` ${normalized} `)) return company
  }
  return (
    firstMatch([COMPANY_IN_SENTENCE], input.subject) ??
    firstMatch([COMPANY_IN_SENTENCE], text) ??
    firstMatch([COMPANY_PREFIX], input.subject)
  )
}

const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/g

function findLink(text: string): string | null {
  const urls = [...text.matchAll(URL_PATTERN)].map((match) =>
    match[0].replace(/[.,;]+$/, "")
  )
  const useful = urls.filter(
    (url) => !/unsubscribe|descadastr|privacy|privacidade/i.test(url)
  )
  return (
    useful.find((url) =>
      /teste|test|assessment|challenge|desafio|calendly|meet\.|vaga|job/i.test(
        url
      )
    ) ??
    useful[0] ??
    null
  )
}

/** Rule-based classification used by the fake model. Exported for tests and evals. */
export function fakeClassifyEmail(
  input: ClassifierInput
): EmailClassificationOutput {
  const text = input.body
  const verdict = decide(fold(input.subject), fold(text), input.fromAddress)
  const describes =
    verdict.class !== "irrelevante" &&
    verdict.class !== "codigo_verificacao" &&
    verdict.class !== "vaga_alerta"
  const deadline =
    verdict.class === "teste_etapa"
      ? parseDeadline(`${input.subject}\n${text}`, input.receivedAt, {
          fallbackToFirst: true,
        })
      : null
  const interviewAt =
    verdict.class === "convite_entrevista"
      ? parseInterviewTime(`${input.subject}\n${text}`, input.receivedAt)
      : null
  return {
    class: verdict.class,
    confidence: verdict.confidence,
    company: describes ? findCompany(input, text) : null,
    role: describes
      ? firstMatch(ROLE_PATTERNS, `${input.subject}\n${text}`)
      : null,
    deadline: deadline ? toZonedIso(deadline) : null,
    interviewAt: interviewAt ? toZonedIso(interviewAt) : null,
    link: describes ? findLink(text) : null,
    reasoning_short: verdict.why,
  }
}

const usage = {
  inputTokens: {
    total: 0,
    noCache: 0,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 0, text: 0, reasoning: undefined },
}

/** Fake model answering the classification call with `fakeClassifyEmail(input)`. */
export function createFakeClassifierModel(
  input: ClassifierInput
): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    provider: "vagapilot-fake",
    modelId: FAKE_CLASSIFIER_MODEL_ID,
    doGenerate: async () => ({
      content: [
        { type: "text", text: JSON.stringify(fakeClassifyEmail(input)) },
      ],
      finishReason: { unified: "stop", raw: undefined },
      usage,
      warnings: [],
    }),
  })
}
