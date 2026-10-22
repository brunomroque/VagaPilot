/** @vitest-environment happy-dom */

import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import type { ApplicationPackagePayload } from "@vagapilot/core/application-package"
import { describe, expect, it } from "vitest"
import { Window } from "happy-dom"

import { formAdapterFor } from "./adapters.js"
import { isSensitiveField, isSubmitControl } from "./dom.js"
import { matchProfileValue } from "./match.js"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../../../")

function loadFixture(name: string): Document {
  const html = readFileSync(join(repoRoot, "fixtures/ats", name), "utf8")
  const window = new Window({
    url: "https://empresaficticia.gupy.io/jobs/apply",
  })
  window.document.write(html)
  return window.document as unknown as Document
}

const payload: ApplicationPackagePayload = {
  version: 1,
  applicationId: "00000000-0000-4000-8000-000000000001",
  jobSource: "gupy",
  company: "Empresa Fictícia",
  roleTitle: "Analista",
  profile: {
    firstName: "Marina",
    lastName: "Alves",
    displayName: "Marina Alves",
    email: "marina@vagapilot.test",
    phone: "+55 11 90000-0000",
    city: "São Paulo",
    state: "SP",
    country: "BR",
    linkedinUrl: null,
    portfolioUrl: null,
    cpf: "529.982.247-25",
    documents: null,
  },
  standardAnswers: [
    {
      key: "motivation",
      questionExamples: ["Por que você quer esta vaga"],
      answer: "Quero contribuir com plataformas escaláveis.",
      proposedFrom: { kind: "standard_answer", ref: "motivation" },
    },
  ],
  facts: [],
  cvVersionId: null,
  salaryInformed: null,
}

describe("FormFillAdapter (P5.3, CA8.2–CA8.3)", () => {
  it("CA8.2 fills visible fields and dispatches input/change", async () => {
    const doc = loadFixture("generic-apply.html")
    const adapter = formAdapterFor(doc)
    const fields = adapter.listFields(doc)
    expect(fields.some((f) => f.label.includes("Senha"))).toBe(false)

    for (const field of fields) {
      const value = matchProfileValue(field, payload)
      if (value) await adapter.fill(field, value)
    }

    expect((doc.querySelector("#first") as HTMLInputElement).value).toBe(
      "Marina"
    )
    expect((doc.querySelector("#email") as HTMLInputElement).value).toBe(
      "marina@vagapilot.test"
    )
    expect(
      (doc.querySelector("#motivation") as HTMLTextAreaElement).value
    ).toContain("plataformas")
  })

  it("CA8.3 never treats password or submit controls as fill targets", () => {
    const doc = loadFixture("generic-apply.html")
    const password = doc.querySelector("#senha")!
    expect(isSensitiveField(password as HTMLElement)).toBe(true)
    const submit = doc.querySelector("button[type=submit]")!
    expect(isSubmitControl(submit)).toBe(true)
    expect(
      formAdapterFor(doc)
        .listFields(doc)
        .every((f) => !isSensitiveField(f.element))
    ).toBe(true)
  })

  it("CA8.4 detects confirmation pages", () => {
    const doc = loadFixture("gupy-confirmation.html")
    const info = formAdapterFor(doc).isConfirmationPage(doc)
    expect(info?.protocolText).toContain("FICT-GUPY-42")
  })
})
