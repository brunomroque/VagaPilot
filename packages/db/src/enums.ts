import { pgEnum } from "drizzle-orm/pg-core"

/** Spec 9.2. Values must stay in sync with supabase/migrations (checked by schema-sync.test.ts). */
export const employmentTypeValues = [
  "clt",
  "pj",
  "autonomo",
  "estagio",
  "temporario",
  "cooperado",
  "outro",
] as const

export const seniorityValues = [
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

export const workModelValues = ["presencial", "hibrido", "remoto"] as const

export const contractRegimeValues = [
  "clt",
  "pj",
  "ambos",
  "nao_informado",
] as const

export const factStatusValues = ["proposto", "confirmado", "rejeitado"] as const

export const fitLevelValues = ["alto", "medio", "baixo"] as const

export const jobSourceValues = [
  "linkedin",
  "gupy",
  "inhire",
  "greenhouse",
  "lever",
  "workday",
  "successfactors",
  "quickin",
  "jobbol",
  "solides",
  "email",
  "indicacao",
  "outro",
] as const

export const applicationRouteValues = [
  "extensao",
  "email",
  "manual",
  "autonomo",
] as const

export const applicationStatusValues = [
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
] as const

export const eventSourceValues = [
  "usuario",
  "agente",
  "extensao",
  "gmail",
  "worker",
  "sistema",
] as const

export const approvalStatusValues = [
  "pendente",
  "aprovada",
  "rejeitada",
  "expirada",
] as const

export const approvalKindValues = [
  "enviar_email",
  "submeter_formulario",
  "responder_pergunta",
  "alterar_cv",
  "criar_fato",
  "pre_autorizacao",
] as const

export const emailClassValues = [
  "confirmacao",
  "reprovacao",
  "teste_etapa",
  "convite_entrevista",
  "recrutador_contato",
  "vaga_alerta",
  "irrelevante",
] as const

export type EmploymentType = (typeof employmentTypeValues)[number]
export type Seniority = (typeof seniorityValues)[number]
export type WorkModel = (typeof workModelValues)[number]
export type ContractRegime = (typeof contractRegimeValues)[number]
export type FactStatus = (typeof factStatusValues)[number]
export type FitLevel = (typeof fitLevelValues)[number]
export type JobSource = (typeof jobSourceValues)[number]
export type ApplicationRoute = (typeof applicationRouteValues)[number]
export type ApplicationStatus = (typeof applicationStatusValues)[number]
export type EventSource = (typeof eventSourceValues)[number]
export type ApprovalStatus = (typeof approvalStatusValues)[number]
export type ApprovalKind = (typeof approvalKindValues)[number]
export type EmailClass = (typeof emailClassValues)[number]

export const employmentType = pgEnum("employment_type", employmentTypeValues)
export const seniority = pgEnum("seniority", seniorityValues)
export const workModel = pgEnum("work_model", workModelValues)
export const contractRegime = pgEnum("contract_regime", contractRegimeValues)
export const factStatus = pgEnum("fact_status", factStatusValues)
export const fitLevel = pgEnum("fit_level", fitLevelValues)
export const jobSource = pgEnum("job_source", jobSourceValues)
export const applicationRoute = pgEnum(
  "application_route",
  applicationRouteValues
)
export const applicationStatus = pgEnum(
  "application_status",
  applicationStatusValues
)
export const eventSource = pgEnum("event_source", eventSourceValues)
export const approvalStatus = pgEnum("approval_status", approvalStatusValues)
export const approvalKind = pgEnum("approval_kind", approvalKindValues)
export const emailClass = pgEnum("email_class", emailClassValues)

/** Consent purposes (spec 9.3 consents.purpose). */
export const consentPurposeValues = [
  "termos",
  "privacidade",
  "ia_cv",
  "gmail_leitura",
  "gmail_envio",
  "diversidade",
  "marketing",
] as const

export type ConsentPurpose = (typeof consentPurposeValues)[number]
