import type { JobSource } from "../types.js"
import { attachCvFile, collectFormFields, setFieldValue } from "./dom.js"
import type {
  ConfirmationInfo,
  FormFillAdapter,
  FormField,
  FillValue,
} from "./types.js"

export function createGenericFormAdapter(
  source: JobSource = "outro"
): FormFillAdapter {
  return {
    ats: source,
    detect() {
      return true
    },
    listFields(doc) {
      return collectFormFields(doc)
    },
    async fill(field, value) {
      await setFieldValue(field, value)
    },
    async attachCv(input, file) {
      await attachCvFile(input, file)
    },
    isConfirmationPage(doc): ConfirmationInfo | null {
      const body = doc.body?.textContent ?? ""
      if (
        /candidatura (recebida|enviada)|application (received|submitted)|protocolo/i.test(
          body
        )
      ) {
        const protocol =
          /protocolo[:\s]+([A-Z0-9-]+)/i.exec(body)?.[1] ??
          /reference[:\s]+([A-Z0-9-]+)/i.exec(body)?.[1] ??
          null
        return { protocolText: protocol, url: doc.location?.href ?? "" }
      }
      return null
    },
  }
}

export function confirmationFromSelectors(
  doc: Document,
  selectors: string[]
): ConfirmationInfo | null {
  for (const selector of selectors) {
    const node = doc.querySelector(selector)
    if (node?.textContent?.trim()) {
      return {
        protocolText: node.textContent.trim(),
        url: doc.location?.href ?? "",
      }
    }
  }
  return null
}

export type HostDetect = (doc: Document) => boolean

export function hostAdapter(
  source: JobSource,
  detect: HostDetect,
  confirmationSelectors: string[] = []
): FormFillAdapter {
  const base = createGenericFormAdapter(source)
  return {
    ...base,
    ats: source,
    detect,
    isConfirmationPage(doc) {
      return (
        confirmationFromSelectors(doc, confirmationSelectors) ??
        base.isConfirmationPage(doc)
      )
    },
  }
}

export type { FormField, FillValue }
