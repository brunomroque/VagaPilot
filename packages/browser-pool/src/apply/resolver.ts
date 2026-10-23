import { matchProfileValue, type FormField } from "@vagapilot/ats-adapters/form"
import { isConsentLabel } from "@vagapilot/core/risks"

import type {
  FieldInfo,
  FillContext,
  ResolvedAnswer,
  UnknownQuestion,
} from "./types.js"

export function normalizeLabel(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[*:?()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

const SENSITIVE =
  /senha|password|passcode|cart[aã]o de cr[eé]dito|credit.?card|cvv|security code|token|c[oó]digo de verifica/i

export function isSensitive(field: Pick<FieldInfo, "label" | "name">): boolean {
  return SENSITIVE.test(`${field.label} ${field.name ?? ""}`)
}

function asFormField(field: FieldInfo): FormField {
  return {
    id: field.key,
    kind: field.kind === "number" ? "text" : field.kind,
    label: field.label,
    name: field.name,
    autocomplete: field.autocomplete,
    required: field.required,
    options: field.options,
    element: null as unknown as HTMLElement,
  }
}

/** Matches a free-text answer to one of the options; null when none fits (never guesses). */
export function pickOption(options: string[], answer: string): string | null {
  const target = normalizeLabel(answer)
  if (!target) return null
  const normalized = options.map(
    (option) => [option, normalizeLabel(option)] as const
  )
  const exact = normalized.find(([, n]) => n === target)
  if (exact) return exact[0]
  const yes = /^(sim|yes|s|y)$/.test(target)
  const no = /^(nao|no|n)$/.test(target)
  if (yes || no) {
    const found = normalized.find(([, n]) =>
      (yes ? /^(sim|yes)\b/ : /^(nao|no)\b/).test(n)
    )
    if (found) return found[0]
  }
  const contains = normalized.filter(
    ([, n]) =>
      n.length >= 3 &&
      target.length >= 3 &&
      (n.includes(target) || target.includes(n))
  )
  return contains.length === 1 ? contains[0]![0] : null
}

export const CONSENT_ACCEPT = "Aceito"
export const CONSENT_CANCEL = "Cancelar"

/** Terms / privacy / marketing / consent checkbox (never ticked without the user's "Aceito"). */
export function isConsentField(field: Pick<FieldInfo, "kind" | "label" | "name">): boolean {
  return (
    field.kind === "checkbox" &&
    isConsentLabel(`${field.label} ${field.name ?? ""}`)
  )
}

/**
 * Consent checkboxes: ticked only when the user answered "Aceito" in this run. Optional ones
 * the user did not accept are left (or put back) unchecked. Never resolved from the profile
 * or standard answers.
 */
function resolveConsent(field: FieldInfo, ctx: FillContext): ResolvedAnswer | null {
  const key = normalizeLabel(field.label || field.name || "")
  const answer = key ? ctx.runAnswers[key] : undefined
  if (answer !== undefined && normalizeLabel(answer) === normalizeLabel(CONSENT_ACCEPT))
    return { label: field.label, value: "sim", source: "run_answer" }
  if (!field.required && /^(sim|yes|true|on)$/i.test(field.currentValue ?? ""))
    return { label: field.label, value: "nao", source: "run_answer" }
  return null
}

/**
 * Value for one field from (1) answers the user gave in this run, (2) the profile,
 * (3) standard answers. Returns null instead of inventing anything.
 */
export function resolveField(
  field: FieldInfo,
  ctx: FillContext
): ResolvedAnswer | null {
  if (isSensitive(field)) return null
  if (isConsentField(field)) return resolveConsent(field, ctx)
  if (field.kind === "file") {
    return ctx.cvPath &&
      /curr[ií]culo|cv|resume|anexo|arquivo/i.test(
        `${field.label} ${field.name ?? ""}`
      )
      ? { label: field.label, value: ctx.cvPath, source: "cv" }
      : null
  }
  const key = normalizeLabel(field.label || field.name || "")
  let value: string | null = null
  let source: ResolvedAnswer["source"] = "run_answer"
  if (key && ctx.runAnswers[key] !== undefined) {
    value = ctx.runAnswers[key] ?? null
  } else {
    const profileValue = matchProfileValue(asFormField(field), ctx.payload)
    if (profileValue) {
      value = profileValue
      const fromStandard = ctx.payload.standardAnswers.some(
        (a) => a.answer === profileValue
      )
      source = fromStandard ? "standard_answer" : "profile"
    }
  }
  if (value === null || !value.trim()) return null
  if (field.kind === "select" || field.kind === "radio") {
    const option = pickOption(field.options, value)
    if (!option) return null
    value = option
  }
  if (field.kind === "checkbox") {
    const normalized = normalizeLabel(value)
    if (normalized === normalizeLabel(CONSENT_ACCEPT) && source === "run_answer")
      return { label: field.label, value: "sim", source }
    if (!/^(sim|yes|true|nao|no|false)$/.test(normalized)) return null
  }
  return { label: field.label, value, source }
}

/** Required fields still empty after resolution become questions for the user. */
export function partitionFields(
  fields: FieldInfo[],
  ctx: FillContext
): {
  answers: { field: FieldInfo; answer: ResolvedAnswer }[]
  unknown: UnknownQuestion[]
} {
  const answers: { field: FieldInfo; answer: ResolvedAnswer }[] = []
  const unknown: UnknownQuestion[] = []
  const seen = new Set<string>()
  for (const field of fields) {
    const answer = resolveField(field, ctx)
    if (answer) {
      answers.push({ field, answer })
      continue
    }
    const consent = isConsentField(field)
    const hasValue = Boolean(field.currentValue && field.currentValue.trim())
    // A required consent box pre-checked by the site still needs the user's own decision.
    if (!field.required || (hasValue && !consent) || field.kind === "file") continue
    const label = field.label || field.name || "Pergunta sem rótulo"
    const norm = normalizeLabel(label)
    if (seen.has(norm)) continue
    seen.add(norm)
    unknown.push(
      consent
        ? {
            label,
            kind: field.kind,
            options: [CONSENT_ACCEPT, CONSENT_CANCEL],
            required: true,
            consent: { termsUrl: field.linkHref ?? null },
          }
        : { label, kind: field.kind, options: field.options, required: field.required }
    )
  }
  return { answers, unknown }
}
