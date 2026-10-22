import type { ApplicationPackagePayload } from "@vagapilot/core/application-package"
import {
  formAdapterFor,
  isLinkedInApplyPage,
  isSensitiveField,
  isSubmitControl,
  matchProfileValue,
} from "@vagapilot/ats-adapters/form"

export type FillReport = {
  filled: number
  skipped: number
  linkedInSuggestionsOnly: boolean
  suggestions: { label: string; value: string }[]
  unknownQuestions: { label: string; fieldType: string }[]
}

export async function fillApplicationForm(
  doc: Document,
  payload: ApplicationPackagePayload,
  cvFile: File | null
): Promise<FillReport> {
  if (isLinkedInApplyPage(doc)) {
    return {
      filled: 0,
      skipped: 0,
      linkedInSuggestionsOnly: true,
      suggestions: buildLinkedInSuggestions(payload),
      unknownQuestions: [],
    }
  }

  const adapter = formAdapterFor(doc)
  const fields = adapter.listFields(doc)
  let filled = 0
  let skipped = 0
  const unknownQuestions: FillReport["unknownQuestions"] = []

  for (const field of fields) {
    if (isSensitiveField(field.element) || isSubmitControl(field.element)) {
      skipped += 1
      continue
    }
    if (
      field.kind === "file" &&
      cvFile &&
      field.element instanceof HTMLInputElement
    ) {
      await adapter.attachCv(field.element, cvFile)
      filled += 1
      continue
    }
    const value = matchProfileValue(field, payload)
    if (value) {
      await adapter.fill(field, value)
      filled += 1
    } else if (field.required) {
      unknownQuestions.push({
        label: field.label || field.name || field.id,
        fieldType: field.kind,
      })
    } else {
      skipped += 1
    }
  }

  return {
    filled,
    skipped,
    linkedInSuggestionsOnly: false,
    suggestions: [],
    unknownQuestions,
  }
}

function buildLinkedInSuggestions(payload: ApplicationPackagePayload) {
  return [
    { label: "Nome", value: payload.profile.displayName },
    { label: "E-mail", value: payload.profile.email ?? "" },
    { label: "Telefone", value: payload.profile.phone ?? "" },
  ].filter((item) => item.value)
}

export function detectConfirmation(doc: Document) {
  return formAdapterFor(doc).isConfirmationPage(doc)
}

/** Applies chat answers to fields matched by label (extension question loop). */
export async function fillAnswersByLabel(
  doc: Document,
  answers: { label: string; value: string }[]
): Promise<number> {
  if (answers.length === 0) return 0
  const adapter = formAdapterFor(doc)
  const fields = adapter.listFields(doc)
  let filled = 0
  for (const answer of answers) {
    const target = fields.find(
      (field) =>
        field.label.trim().toLowerCase() === answer.label.trim().toLowerCase()
    )
    if (
      !target ||
      isSensitiveField(target.element) ||
      isSubmitControl(target.element)
    ) {
      continue
    }
    await adapter.fill(target, answer.value)
    filled += 1
  }
  return filled
}
