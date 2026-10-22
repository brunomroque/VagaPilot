import type { JobSource } from "../types.js"

export type FormFieldKind =
  | "text"
  | "email"
  | "tel"
  | "url"
  | "textarea"
  | "select"
  | "checkbox"
  | "radio"
  | "file"
  | "unknown"

export type FormField = {
  id: string
  kind: FormFieldKind
  label: string
  name: string | null
  autocomplete: string | null
  required: boolean
  options: string[]
  element: HTMLElement
}

export type FillValue = string | boolean | File

export type ConfirmationInfo = {
  protocolText: string | null
  url: string
}

/** Form fill side of an ATS (spec 11.1). Never clicks submit in MVP. */
export interface FormFillAdapter {
  ats: JobSource
  detect(doc: Document): boolean
  listFields(doc: Document): FormField[]
  fill(field: FormField, value: FillValue): Promise<void>
  attachCv(input: HTMLInputElement, file: File): Promise<void>
  isConfirmationPage(doc: Document): ConfirmationInfo | null
}
