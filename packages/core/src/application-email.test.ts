import { describe, expect, it } from "vitest"

import {
  countWords,
  hashEmailDraftSnapshot,
  jobPostingAsksSalary,
  validateApplicationEmailDraft,
} from "./application-email.js"

describe("application email draft (P6.1)", () => {
  it("CA6.1 rejects drafts over 150 words", () => {
    const body = Array.from({ length: 151 }, (_, i) => `word${i}`).join(" ")
    expect(
      validateApplicationEmailDraft({
        body,
        jobAsksSalary: false,
        includeSalaryWhenAsked: true,
      })
    ).toEqual({ ok: false, code: "too_long", words: 151 })
  })

  it("CA6.1 omits salary when the job does not ask", () => {
    const result = validateApplicationEmailDraft({
      body: "Olá, tenho interesse na vaga. Minha pretensão é R$ 12.000.",
      jobAsksSalary: false,
      includeSalaryWhenAsked: true,
    })
    expect(result).toEqual({ ok: false, code: "salary_not_allowed" })
  })

  it("hash changes when the draft body changes", () => {
    const base = {
      to: ["recrutador@exemplo.test"],
      cc: [] as string[],
      subject: "Candidatura",
      bodyMd: "Olá",
      attachmentCvVersionId: null,
    }
    const a = hashEmailDraftSnapshot(base)
    const b = hashEmailDraftSnapshot({ ...base, bodyMd: "Olá!" })
    expect(a).not.toBe(b)
  })

  it("detects salary requests in postings", () => {
    expect(jobPostingAsksSalary("Informe sua pretensão salarial")).toBe(true)
    expect(jobPostingAsksSalary("Vaga para desenvolvedor pleno")).toBe(false)
  })

  it("countWords ignores extra whitespace", () => {
    expect(countWords("  uma   duas  ")).toBe(2)
  })
})
