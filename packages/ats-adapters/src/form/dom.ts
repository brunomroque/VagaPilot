import type { FormField, FormFieldKind, FillValue } from "./types.js"

const PASSWORD_TYPES = new Set(["password"])
const SENSITIVE_AUTOCOMPLETE =
  /^(current-password|new-password|one-time-code|cc-|username)$/i

export function isSensitiveField(el: HTMLElement): boolean {
  if (!(el instanceof HTMLInputElement)) return false
  if (PASSWORD_TYPES.has(el.type)) return true
  const ac = el.autocomplete?.trim() ?? ""
  if (SENSITIVE_AUTOCOMPLETE.test(ac)) return true
  if (
    /senha|password|otp|código de verificação/i.test(
      el.labels?.[0]?.textContent ?? el.name ?? ""
    )
  ) {
    return true
  }
  return false
}

export function isSubmitControl(el: Element): boolean {
  if (el instanceof HTMLButtonElement) {
    if (el.type === "submit") return true
    if (/enviar|submit|candidatar|apply/i.test(el.textContent ?? ""))
      return true
  }
  if (el instanceof HTMLInputElement && el.type === "submit") return true
  return false
}

function fieldKind(el: HTMLElement): FormFieldKind {
  if (el instanceof HTMLTextAreaElement) return "textarea"
  if (el instanceof HTMLSelectElement) return "select"
  if (el instanceof HTMLInputElement) {
    switch (el.type) {
      case "email":
        return "email"
      case "tel":
        return "tel"
      case "url":
        return "url"
      case "checkbox":
        return "checkbox"
      case "radio":
        return "radio"
      case "file":
        return "file"
      default:
        return "text"
    }
  }
  return "unknown"
}

function labelFor(el: HTMLElement, doc: Document): string {
  if (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement
  ) {
    const id = el.id
    if (id) {
      const label = doc.querySelector(`label[for="${CSS.escape(id)}"]`)
      if (label?.textContent) return label.textContent.trim()
    }
  }
  const aria = el.getAttribute("aria-label")
  if (aria) return aria.trim()
  const placeholder = el.getAttribute("placeholder")
  if (placeholder) return placeholder.trim()
  const name = el.getAttribute("name")
  return name?.trim() ?? ""
}

export function collectFormFields(doc: Document): FormField[] {
  const nodes = doc.querySelectorAll("input, textarea, select")
  const fields: FormField[] = []
  let index = 0
  for (const node of nodes) {
    const el = node as HTMLElement
    if (isSensitiveField(el)) continue
    if (el instanceof HTMLInputElement && el.type === "hidden") continue
    const kind = fieldKind(el)
    if (kind === "unknown") continue
    const label = labelFor(el, doc)
    const name = el.getAttribute("name")
    const autocomplete = el.getAttribute("autocomplete")
    const required =
      el.hasAttribute("required") || el.getAttribute("aria-required") === "true"
    const options =
      el instanceof HTMLSelectElement
        ? [...el.options]
            .map((opt) => opt.textContent?.trim() ?? "")
            .filter(Boolean)
        : []
    fields.push({
      id: `field-${index++}`,
      kind,
      label,
      name,
      autocomplete,
      required,
      options,
      element: el,
    })
  }
  return fields
}

export function dispatchInputEvents(el: HTMLElement): void {
  el.dispatchEvent(new Event("input", { bubbles: true }))
  el.dispatchEvent(new Event("change", { bubbles: true }))
}

export async function setFieldValue(
  field: FormField,
  value: FillValue
): Promise<void> {
  const el = field.element
  if (field.kind === "checkbox") {
    if (el instanceof HTMLInputElement) {
      el.checked = Boolean(value)
      dispatchInputEvents(el)
    }
    return
  }
  if (field.kind === "radio") {
    if (el instanceof HTMLInputElement && typeof value === "string") {
      if (el.value === value || labelFor(el, el.ownerDocument!) === value) {
        el.checked = true
        dispatchInputEvents(el)
      }
    }
    return
  }
  if (field.kind === "select") {
    if (el instanceof HTMLSelectElement && typeof value === "string") {
      const option = [...el.options].find(
        (opt) =>
          opt.value === value || (opt.textContent?.trim() ?? "") === value
      )
      if (option) el.value = option.value
      dispatchInputEvents(el)
    }
    return
  }
  if (typeof value === "string") {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      el.value = value
      dispatchInputEvents(el)
    }
  }
}

export async function attachCvFile(
  input: HTMLInputElement,
  file: File
): Promise<void> {
  const dt = new DataTransfer()
  dt.items.add(file)
  input.files = dt.files
  dispatchInputEvents(input)
}
