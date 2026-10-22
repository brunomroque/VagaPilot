import type { ApplicationPackagePayload } from "@vagapilot/core/application-package"

import type { FormField } from "./types.js"

const LABEL_PATTERNS: {
  re: RegExp
  pick: (p: ApplicationPackagePayload["profile"]) => string | null
}[] = [
  { re: /primeiro.?nome|first.?name|given.?name/i, pick: (p) => p.firstName },
  {
    re: /(último|ultimo).?nome|sobrenome|last.?name|surname|family.?name/i,
    pick: (p) => p.lastName,
  },
  { re: /nome.?completo|full.?name/i, pick: (p) => p.displayName },
  { re: /e-?mail|correio/i, pick: (p) => p.email },
  { re: /telefone|phone|celular|whatsapp/i, pick: (p) => p.phone },
  { re: /linkedin/i, pick: (p) => p.linkedinUrl },
  { re: /portf[oó]lio|website|site/i, pick: (p) => p.portfolioUrl },
  { re: /cidade|city/i, pick: (p) => p.city },
  { re: /estado|state|uf\b/i, pick: (p) => p.state },
  { re: /cpf/i, pick: (p) => p.cpf },
]

function haystack(field: FormField): string {
  return [field.label, field.name, field.autocomplete].filter(Boolean).join(" ")
}

export function matchProfileValue(
  field: FormField,
  payload: ApplicationPackagePayload
): string | null {
  const text = haystack(field)
  for (const rule of LABEL_PATTERNS) {
    if (rule.re.test(text)) {
      const value = rule.pick(payload.profile)
      if (value) return value
    }
  }
  if (field.autocomplete) {
    switch (field.autocomplete) {
      case "given-name":
        return payload.profile.firstName
      case "family-name":
        return payload.profile.lastName
      case "name":
        return payload.profile.displayName
      case "email":
        return payload.profile.email
      case "tel":
        return payload.profile.phone
      case "address-level2":
        return payload.profile.city
      case "address-level1":
        return payload.profile.state
      default:
        break
    }
  }
  for (const answer of payload.standardAnswers) {
    for (const example of answer.questionExamples) {
      if (
        example &&
        text.toLowerCase().includes(example.toLowerCase().slice(0, 12))
      ) {
        return answer.answer
      }
    }
    if (field.name && field.name === answer.key) return answer.answer
  }
  return null
}
