import { FACT_KINDS } from "@vagapilot/core/facts"
import {
  FIT_LEVEL_VALUES,
  JOB_LANGUAGES,
  LANGUAGE_LEVEL_VALUES,
  REGIME_VALUES,
  SENIORITY_LEVELS,
  WORK_MODEL_VALUES,
} from "@vagapilot/core/job-rules"
import { MAX_LINKS_PER_BATCH } from "@vagapilot/core/guardrails"
import type { ChatToolName } from "@vagapilot/core/policy"
import {
  ACCEPTED_SALARY_REGIMES,
  APPROVAL_MODES,
  PREFERENCE_KEYS,
  SALARY_CURRENCIES,
  SALARY_PERIODS_VALUES,
  SEARCH_FREQUENCIES,
  SEARCH_REGIMES,
  TIMES_OF_DAY,
} from "@vagapilot/core/settings"
import { z } from "zod"

/*
 * Tool inputs (spec 10.3). Plain schemas without transforms so they convert to JSON Schema
 * for the model; the server normalizes with the core settings model before writing.
 */

const searchFields = {
  query: z.string().min(2).max(120).describe("Cargo ou palavras-chave"),
  seniority: z.enum(SENIORITY_LEVELS).optional(),
  location: z
    .string()
    .max(120)
    .optional()
    .describe("Cidade/estado; omita para remoto em qualquer lugar"),
  radiusKm: z.number().int().min(0).max(500).optional(),
  workModel: z.enum(WORK_MODEL_VALUES).optional(),
  regime: z.enum(SEARCH_REGIMES).optional(),
  language: z.enum(JOB_LANGUAGES).optional(),
  salaryMin: z.number().nonnegative().optional(),
  salaryMax: z.number().nonnegative().optional(),
  postedWithinDays: z.number().int().min(1).max(90).optional(),
  excludedCompanies: z.array(z.string().min(1).max(160)).max(50).optional(),
  frequency: z
    .enum(SEARCH_FREQUENCIES)
    .describe("diaria, dias_uteis ou semanal"),
  timeOfDay: z.enum(TIMES_OF_DAY).optional(),
}

export const savedSearchToolInput = z.object(searchFields)

const searchSelector = {
  id: z.uuid().optional().describe("id da busca (de get_settings)"),
  match: z
    .string()
    .max(120)
    .optional()
    .describe("Trecho do cargo da busca, quando não houver id"),
}

export const chatToolInputSchemas = {
  ingest_job_postings: z.object({
    urls: z.array(z.string().max(2000)).max(MAX_LINKS_PER_BATCH).optional(),
    text: z.string().max(8000).optional(),
  }),
  get_job_match: z.object({ jobPostingId: z.uuid() }),
  check_duplicate: z.object({ jobPostingId: z.uuid() }),
  search_facts: z.object({
    query: z.string().min(2).max(300),
    k: z.number().int().min(1).max(20).optional(),
  }),
  get_profile_summary: z.object({}),
  recommend_cv: z.object({ jobPostingId: z.uuid() }),
  suggest_salary: z.object({
    seniority: z.enum(SENIORITY_LEVELS),
    regime: z.enum(REGIME_VALUES),
  }),
  record_decision: z.object({
    jobMatchId: z.uuid(),
    decision: z.enum(["aplicar", "pular", "salvar"]),
    reason: z.string().max(300).optional(),
  }),
  list_pending_actions: z.object({}),
  get_settings: z.object({}),
  ask_clarification: z.object({
    question: z.string().min(3).max(300),
    options: z.array(z.string().min(1).max(80)).min(2).max(6),
  }),
  create_saved_search: savedSearchToolInput,
  update_saved_search: z.object({
    ...searchSelector,
    changes: z.object(searchFields).partial(),
  }),
  delete_saved_search: z.object(searchSelector),
  add_excluded_company: z.object({ company: z.string().min(1).max(160) }),
  remove_excluded_company: z.object({ company: z.string().min(1).max(160) }),
  update_language_level: z.object({
    language: z.string().min(2).max(60),
    level: z.enum(LANGUAGE_LEVEL_VALUES),
  }),
  set_salary_rules: z.object({
    rules: z
      .array(
        z.object({
          seniority: z.enum(SENIORITY_LEVELS),
          regime: z.enum(ACCEPTED_SALARY_REGIMES).optional(),
          amount: z.number().positive(),
          min: z.number().positive().optional(),
          currency: z.enum(SALARY_CURRENCIES).optional(),
          period: z.enum(SALARY_PERIODS_VALUES).optional(),
        })
      )
      .min(1)
      .max(22),
  }),
  set_preference: z.object({
    key: z.enum(PREFERENCE_KEYS),
    value: z.union([z.boolean(), z.enum(FIT_LEVEL_VALUES)]),
  }),
  set_approval_mode: z.object({
    mode: z.enum(APPROVAL_MODES),
    scope: z.literal("padrao").optional(),
  }),
  undo_change: z.object({
    memoryEventId: z.uuid().optional().describe("Omita para a última mudança"),
  }),
  propose_fact: z.object({
    statement: z.string().min(5).max(500),
    kind: z
      .enum(FACT_KINDS)
      .describe(
        "conquista = resultado concreto entregue; competencia = habilidade específica. Headline/título do perfil, cargo ou trajetória numa empresa não são fatos: não proponha."
      ),
    experienceId: z.uuid().optional(),
  }),
  export_tracker: z.object({
    format: z.enum(["csv", "pdf"]).optional(),
  }),
  draft_application_email: z.object({
    applicationId: z.uuid(),
  }),
  request_send_email: z.object({
    draftId: z.uuid(),
  }),
  send_email: z.object({
    approvalId: z.uuid(),
  }),
  open_screen: z.object({
    screen: z.enum([
      "home",
      "panel",
      "chat",
      "applications",
      "tasks",
      "cvs",
      "searches",
      "memory",
      "facts",
      "profile",
      "settings",
      "onboarding",
    ]),
    applicationId: z.uuid().optional(),
    cvVersionId: z.uuid().optional(),
    factId: z.uuid().optional(),
    searchId: z.uuid().optional(),
  }),
  ats_score: z.object({
    cvVersionId: z.uuid(),
    jobPostingId: z.uuid(),
    jobMatchId: z.uuid().optional(),
  }),
  propose_cv_adjustment: z.object({
    cvVersionId: z.uuid(),
    jobPostingId: z.uuid(),
    trackId: z.uuid().optional(),
  }),
  apply_cv_adjustment: z.object({
    approvalId: z.uuid(),
  }),
  ensure_hybrid_cv: z.object({
    sourceCvVersionId: z.uuid().optional(),
  }),
  list_cv_tracks: z.object({}),
  create_application: z.object({
    jobMatchId: z.uuid(),
    cvVersionId: z.uuid().optional(),
    status: z.enum(["rascunho", "em_andamento"]).optional(),
  }),
  update_application_status: z.object({
    applicationId: z.uuid(),
    status: z.enum([
      "rascunho",
      "descartada",
      "em_andamento",
      "enviada",
      "em_analise",
      "etapa_pendente",
      "entrevista",
      "proposta",
      "reprovada",
      "encerrada",
    ]),
  }),
  read_gmail: z.object({
    applicationId: z.uuid().optional(),
    query: z.string().max(200).optional(),
    limit: z.number().int().min(1).max(10).optional(),
  }),
  answer_missing_info: z.object({
    pendingQuestionId: z.uuid(),
    answerText: z.string().min(1).max(2000),
  }),
  classify_fact: z.object({
    factId: z.uuid(),
    usage: z.enum(["cv_relevant", "form_only"]),
  }),
  get_profile_tracking: z.object({}),
  mark_profile_updated: z.object({
    platformProfileId: z.uuid(),
  }),
  start_application: z.object({ jobMatchId: z.uuid() }),
} as const satisfies Record<ChatToolName, z.ZodType>

export type ChatToolInput<T extends ChatToolName> = z.infer<
  (typeof chatToolInputSchemas)[T]
>

/** What the model reads about each tool (pt-BR, F14 table). */
export const CHAT_TOOL_DESCRIPTIONS: Record<ChatToolName, string> = {
  ingest_job_postings:
    "Analisa links ou texto de vagas (até 20). Devolve ids do lote; os cartões aparecem sozinhos.",
  get_job_match: "Lê a análise de aderência de uma vaga já analisada.",
  check_duplicate:
    "Verifica se a pessoa já se candidatou a esta vaga (controle interno).",
  search_facts:
    "Busca fatos CONFIRMADOS da pessoa. Única fonte para afirmar experiência.",
  get_profile_summary: "Resumo do perfil sem dados sensíveis.",
  recommend_cv: "Recomenda a versão de CV (idioma da vaga + trilha).",
  suggest_salary: "Pretensão pela regra da pessoa (determinística).",
  record_decision:
    "Registra Aplicar, Pular ou Salvar numa vaga, quando a pessoa pede.",
  list_pending_actions:
    "Lista ações pendentes com prazo e contagens do controle.",
  get_settings:
    "Lê configurações, buscas salvas, empresas excluídas, idiomas e pretensões.",
  ask_clarification:
    "Pergunta com opções clicáveis quando o pedido é ambíguo (ex.: 'SP' cidade ou estado).",
  create_saved_search:
    "Cria busca salva. Cargo e local são obrigatórios (local pode faltar se remoto).",
  update_saved_search: "Altera campos de uma busca salva.",
  delete_saved_search: "Exclui uma busca salva (sempre pede confirmação).",
  add_excluded_company: "Exclui uma empresa de todas as vagas e buscas.",
  remove_excluded_company: "Volta a mostrar vagas de uma empresa excluída.",
  update_language_level: "Atualiza o nível declarado de um idioma.",
  set_salary_rules: "Define pretensão por senioridade e regime.",
  set_preference:
    "Define preferência por chave (ex.: email.include_salary=false).",
  set_approval_mode: "Muda o modo de aprovação (sempre pede confirmação).",
  undo_change: "Desfaz uma mudança da Memória (sem id: a última).",
  propose_fact: "Propõe um fato dito pela pessoa; ela confirma no cartão.",
  export_tracker:
    "Gera link de exportação CSV/PDF do controle (planos pagos para PDF).",
  draft_application_email:
    "Cria rascunho de e-mail de candidatura (≤150 palavras, sem salário se a vaga não pedir).",
  request_send_email:
    "Pedido de envio: cria aprovação com hash do rascunho exato.",
  send_email: "Envia o e-mail aprovado (só approvalId; conteúdo vem do banco).",
  open_screen:
    "Devolve um link profundo para uma tela existente do app (candidaturas, CVs, perfil…).",
  ats_score:
    "Calcula score ATS determinístico do CV contra a vaga (keywords cobertas e faltantes).",
  propose_cv_adjustment:
    "Propõe nova versão de CV só com adições baseadas em fatos confirmados (aprovação).",
  apply_cv_adjustment:
    "Aplica ajuste de CV aprovado (só approvalId; valida hash e prazo).",
  ensure_hybrid_cv:
    "Garante trilha Híbrido atualizada com conteúdo cv_relevant (aprovação).",
  list_cv_tracks: "Lista trilhas de CV e versões padrão por idioma.",
  create_application: "Cria candidatura a partir de uma vaga analisada.",
  update_application_status:
    "Atualiza status da candidatura (enviada exige confirmação).",
  read_gmail:
    "Resume threads de e-mail ligadas a candidaturas (somente leitura).",
  answer_missing_info:
    "Processa resposta livre a pergunta pendente e sugere destino (cartão).",
  classify_fact: "Define se fato é cv_relevant ou form_only após confirmação.",
  get_profile_tracking:
    "Lista perfis em plataformas externas e status desatualizado.",
  mark_profile_updated:
    "Marca perfil de plataforma como atualizado manualmente.",
  start_application:
    "Mostra o cartão 'Candidatar na nuvem' (Gupy/LinkedIn) para uma vaga analisada. Não envia nada: o usuário inicia pelo botão, responde perguntas no chat e aprova o resumo antes do envio.",
}
