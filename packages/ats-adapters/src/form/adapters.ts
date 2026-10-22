import { hostAdapter } from "./generic.js"
import type { FormFillAdapter } from "./types.js"

const formAdapters: FormFillAdapter[] = [
  hostAdapter("gupy", (doc) => /gupy\.io/i.test(doc.location?.hostname ?? ""), [
    ".success-message",
  ]),
  hostAdapter(
    "inhire",
    (doc) => /inhire\.app/i.test(doc.location?.hostname ?? ""),
    ["[data-testid='success']"]
  ),
  hostAdapter(
    "greenhouse",
    (doc) => /greenhouse\.io/i.test(doc.location?.hostname ?? ""),
    ["#application_confirmation"]
  ),
  hostAdapter(
    "lever",
    (doc) => /lever\.co/i.test(doc.location?.hostname ?? ""),
    [".confirmation-page"]
  ),
  hostAdapter(
    "workday",
    (doc) => /myworkdayjobs\.com/i.test(doc.location?.hostname ?? ""),
    ["[data-automation-id='successMessage']"]
  ),
  hostAdapter("linkedin", (doc) =>
    /linkedin\.com/i.test(doc.location?.hostname ?? "")
  ),
  hostAdapter("outro", () => true),
]

export function formAdapterFor(doc: Document): FormFillAdapter {
  for (const adapter of formAdapters) {
    if (adapter.ats !== "outro" && adapter.detect(doc)) return adapter
  }
  return formAdapters.at(-1)!
}

/** LinkedIn: suggestions only — never fill the page (spec 13, P5.4). */
export function isLinkedInApplyPage(doc: Document): boolean {
  return /linkedin\.com/i.test(doc.location?.hostname ?? "")
}
