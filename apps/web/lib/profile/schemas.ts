import { isValidCpfInput } from "@vagapilot/core/br-documents"
import { z } from "zod"

/**
 * Profile form schemas (spec F1, F1A, P1.1). Shared by client forms and server actions.
 * Messages are keys of the `Profile.validation` catalog, translated in the UI.
 */

export const EMPLOYMENT_TYPES = [
  "clt",
  "pj",
  "autonomo",
  "estagio",
  "temporario",
  "cooperado",
  "outro",
] as const
export const SENIORITIES = [
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
export const WORK_MODELS = ["presencial", "hibrido", "remoto"] as const
export const ACCEPTED_REGIMES = ["clt", "pj"] as const
export const LANGUAGE_LEVELS = [
  "basico",
  "intermediario",
  "avancado",
  "fluente",
  "nativo",
] as const
export const CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const
export const EDUCATION_LEVELS = [
  "medio",
  "tecnico",
  "graduacao",
  "pos_graduacao",
  "mba",
  "mestrado",
  "doutorado",
  "outro",
] as const
export const EDUCATION_STATUSES = ["concluido", "cursando", "trancado"] as const
export const CURRENCIES = ["BRL", "USD", "EUR"] as const
export const SALARY_PERIODS = ["mensal", "anual", "hora"] as const
export const AVAILABILITY = [
  "imediata",
  "15_dias",
  "30_dias",
  "60_dias",
  "a_combinar",
] as const
export const YES_NO_MAYBE = ["sim", "nao", "a_combinar"] as const
export const EMPLOYMENT_SITUATIONS = ["empregado", "nao_empregado"] as const
export const CURRENT_PAY_MODES = [
  "informar",
  "zero",
  "prefiro_nao_informar",
] as const
export const CV_LANGUAGE_OPTIONS = ["pt-BR", "en", "es"] as const

export const NOT_INFORMED = "prefiro_nao_informar"
export const GENDERS = [
  "mulher",
  "homem",
  "nao_binario",
  "outro",
  NOT_INFORMED,
] as const
export const ORIENTATIONS = [
  "heterossexual",
  "homossexual",
  "bissexual",
  "outra",
  NOT_INFORMED,
] as const
export const RACES = [
  "branca",
  "preta",
  "parda",
  "amarela",
  "indigena",
  NOT_INFORMED,
] as const
export const PCD_OPTIONS = ["sim", "nao", NOT_INFORMED] as const

/** Standard answer keys suggested in the form (RF1.6). Users can add their own keys. */
export const STANDARD_ANSWER_PRESETS = [
  "salario_atual",
  "disponibilidade_inicio",
  "possui_cnh",
  "aceita_viagens",
  "como_soube_da_vaga",
  "nivel_ingles",
  "pcd",
] as const
/** Presets that are sensitive by default (stored in `answer_enc`). */
export const SENSITIVE_ANSWER_KEYS: ReadonlySet<string> = new Set([
  "salario_atual",
  "remuneracao_atual",
  "pcd",
])

const text = (max: number) => z.string().trim().max(max, "tooLong")
const requiredText = (max: number) =>
  z.string().trim().min(1, "required").max(max, "tooLong")
const optionalUrl = z
  .string()
  .trim()
  .max(300, "tooLong")
  .refine(
    (value) => value === "" || /^https?:\/\/\S+\.\S+/.test(value),
    "invalidUrl"
  )
const month = z
  .string()
  .trim()
  .refine((value) => /^\d{4}-(0[1-9]|1[0-2])$/.test(value), "invalidMonth")
const optionalMonth = z
  .string()
  .trim()
  .refine(
    (value) => value === "" || /^\d{4}-(0[1-9]|1[0-2])$/.test(value),
    "invalidMonth"
  )
const optionalYear = z
  .string()
  .trim()
  .refine(
    (value) => value === "" || /^(19|20)\d{2}$/.test(value),
    "invalidYear"
  )
const commaList = text(1000)

export const contactSchema = z.object({
  displayName: requiredText(120),
  firstName: requiredText(60),
  lastName: requiredText(80),
  emailContact: z
    .string()
    .trim()
    .max(254, "tooLong")
    .refine(
      (value) => value === "" || z.email().safeParse(value).success,
      "invalidEmail"
    ),
  phone: text(30).refine(
    (value) =>
      value === "" ||
      (/^\+?[\d\s().-]+$/.test(value) &&
        value.replace(/\D/g, "").length >= 10 &&
        value.replace(/\D/g, "").length <= 13),
    "invalidPhone"
  ),
  birthDate: z
    .string()
    .trim()
    .refine(
      (value) => value === "" || /^\d{4}-\d{2}-\d{2}$/.test(value),
      "invalidDate"
    ),
  city: text(80),
  state: z
    .string()
    .trim()
    .refine(
      (value) => value === "" || /^[A-Za-z]{2}$/.test(value),
      "invalidState"
    ),
  linkedinUrl: optionalUrl,
  portfolioUrl: optionalUrl,
  cvFilenamePattern: requiredText(80).refine(
    (value) => /\{(first|last|full)\}/.test(value),
    "patternNeedsName"
  ),
})
export type ContactInput = z.infer<typeof contactSchema>

export const addressSchema = z.object({
  postalCode: text(12),
  street: text(160),
  number: text(20),
  complement: text(80),
  district: text(80),
})
export type AddressInput = z.infer<typeof addressSchema>

export const documentsSchema = z.object({
  cpf: z
    .string()
    .trim()
    .refine((value) => value === "" || isValidCpfInput(value), "invalidCpf"),
  rg: text(20),
  cnh: text(20),
})
export type DocumentsInput = z.infer<typeof documentsSchema>

export const experienceSchema = z
  .object({
    id: z.uuid().optional(),
    company: requiredText(160),
    title: requiredText(160),
    employmentType: z.enum(EMPLOYMENT_TYPES),
    // Optional: a CV may list an experience without dates. It is saved and shown as a
    // pending item until the user fills in the start month.
    startMonth: optionalMonth,
    endMonth: optionalMonth,
    isCurrent: z.boolean(),
    location: text(120),
    description: text(2000),
  })
  .refine(
    (value) =>
      value.isCurrent || value.startMonth === "" || value.endMonth !== "",
    {
      message: "endRequired",
      path: ["endMonth"],
    }
  )
  .refine(
    (value) =>
      value.isCurrent ||
      value.endMonth === "" ||
      value.startMonth === "" ||
      value.endMonth >= value.startMonth,
    { message: "endBeforeStart", path: ["endMonth"] }
  )
export type ExperienceInput = z.infer<typeof experienceSchema>

export const educationSchema = z.object({
  id: z.uuid().optional(),
  institution: requiredText(160),
  degree: text(120),
  field: text(120),
  level: z.enum(EDUCATION_LEVELS),
  status: z.enum(EDUCATION_STATUSES),
  startYear: optionalYear,
  endYear: optionalYear,
})
export type EducationInput = z.infer<typeof educationSchema>

export const languageSchema = z.object({
  id: z.uuid().optional(),
  language: requiredText(60),
  level: z.enum(LANGUAGE_LEVELS),
  cefr: z.union([z.enum(CEFR_LEVELS), z.literal("")]),
})
export type LanguageInput = z.infer<typeof languageSchema>

export const skillSchema = z.object({ name: requiredText(80) })
export type SkillInput = z.infer<typeof skillSchema>

export const preferencesSchema = z.object({
  workModels: z.array(z.enum(WORK_MODELS)).min(1, "pickOne"),
  regimes: z.array(z.enum(ACCEPTED_REGIMES)).min(1, "pickOne"),
  cities: commaList,
  availability: z.enum(AVAILABILITY),
  travel: z.enum(YES_NO_MAYBE),
  relocation: z.enum(YES_NO_MAYBE),
})
export type PreferencesInput = z.infer<typeof preferencesSchema>

export const situationSchema = z
  .object({
    situation: z.enum(EMPLOYMENT_SITUATIONS),
    currentCompany: text(160),
    currentPayMode: z.enum(CURRENT_PAY_MODES),
    currentPay: text(40),
  })
  .refine(
    (value) =>
      value.currentPayMode !== "informar" ||
      /^\d+([.,]\d{1,2})?$/.test(value.currentPay.replace(/\./g, "")),
    { message: "invalidAmount", path: ["currentPay"] }
  )
export type SituationInput = z.infer<typeof situationSchema>

const amount = z
  .string()
  .trim()
  .refine(
    (value) => /^\d{1,9}([.,]\d{1,2})?$/.test(value.replace(/\./g, "")),
    "invalidAmount"
  )
const optionalAmount = z
  .string()
  .trim()
  .refine(
    (value) =>
      value === "" || /^\d{1,9}([.,]\d{1,2})?$/.test(value.replace(/\./g, "")),
    "invalidAmount"
  )

/** "32.000,50" or "32000.5" → 32000.5 */
export function parseAmount(value: string): number {
  const normalized = value.includes(",")
    ? value.replace(/\./g, "").replace(",", ".")
    : value
  return Number(normalized)
}

export const salaryRuleSchema = z
  .object({
    id: z.uuid().optional(),
    seniority: z.enum(SENIORITIES),
    regime: z.enum(ACCEPTED_REGIMES),
    amountMin: optionalAmount,
    amountTarget: amount,
    currency: z.enum(CURRENCIES),
    period: z.enum(SALARY_PERIODS),
  })
  .refine(
    (value) =>
      value.amountMin === "" ||
      parseAmount(value.amountMin) <= parseAmount(value.amountTarget),
    { message: "minAboveTarget", path: ["amountMin"] }
  )
export type SalaryRuleInput = z.infer<typeof salaryRuleSchema>

export const standardAnswerSchema = z.object({
  id: z.uuid().optional(),
  key: z
    .string()
    .trim()
    .min(1, "required")
    .max(60, "tooLong")
    .refine((value) => /^[a-z0-9_]+$/.test(value), "invalidKey"),
  question: text(300),
  answer: requiredText(2000),
  isSensitive: z.boolean(),
  language: z.enum(CV_LANGUAGE_OPTIONS),
})
export type StandardAnswerInput = z.infer<typeof standardAnswerSchema>

export const blockedCompanySchema = z.object({
  id: z.uuid().optional(),
  companyName: requiredText(160),
  aliases: commaList,
  domains: commaList,
  reason: text(300),
})
export type BlockedCompanyInput = z.infer<typeof blockedCompanySchema>

export const diversitySchema = z.object({
  gender: z.enum(GENDERS),
  sexualOrientation: z.enum(ORIENTATIONS),
  raceColor: z.enum(RACES),
  pcd: z.enum(PCD_OPTIONS),
})
export type DiversityInput = z.infer<typeof diversitySchema>

export const DEFAULT_DIVERSITY: DiversityInput = {
  gender: NOT_INFORMED,
  sexualOrientation: NOT_INFORMED,
  raceColor: NOT_INFORMED,
  pcd: NOT_INFORMED,
}

export function splitList(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[,;\n]/)
        .map((item) => item.trim())
        .filter(Boolean)
    ),
  ]
}

/** Preferences jsonb shape in `candidate_profiles.preferences`. */
export type ProfilePreferences = {
  workModels?: (typeof WORK_MODELS)[number][]
  regimes?: (typeof ACCEPTED_REGIMES)[number][]
  cities?: string[]
  availability?: (typeof AVAILABILITY)[number]
  travel?: (typeof YES_NO_MAYBE)[number]
  relocation?: (typeof YES_NO_MAYBE)[number]
  situation?: {
    situation: (typeof EMPLOYMENT_SITUATIONS)[number]
    currentCompany?: string
    currentPayMode: (typeof CURRENT_PAY_MODES)[number]
  }
  onboarding?: { step: number; completedAt?: string }
}
