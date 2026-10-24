import { describe, expect, it } from "vitest"

import { cvVsJobReport, skillGaps } from "./cv-vs-job"

const cv = {
  id: "cv1",
  name: "cv.docx",
  kind: "cv",
  text: "Engineering Manager - V.tal (2019-2024): ~40 pessoas, SRE, Observabilidade\nIngles Avancado",
}
const job = {
  id: "job1",
  name: "vaga.txt",
  kind: "job_description",
  text: "Empresa: Exemplo Tech SA\nCargo: Engineering Manager - Plataforma\nRequisitos:\n- Kubernetes, Terraform, SLO\n- SRE e gestao de times 20+\n- Ingles avancado",
}

describe("cvVsJobReport (CV + vaga sem texto digitado)", () => {
  it("always returns suggestion items and the approval options", () => {
    const report = cvVsJobReport([cv, job])
    expect(report).not.toBeNull()
    expect(report!.scores).toHaveLength(1)
    expect(report!.text).toMatch(/Score ATS: \d+%/)
    const items = report!.text.split("\n").filter((l) => l.startsWith("- "))
    expect(items.length).toBeGreaterThan(0)
    expect(report!.text).toContain("kubernetes")
    expect(report!.text).not.toMatch(/sugiro os seguintes ajustes\s*$/)
    expect(report!.options).toEqual([
      "Aplicar estes ajustes numa nova versão",
      "Ajustar só alguns",
      "Não ajustar",
    ])
  })

  it("is null without a CV or a job", () => {
    expect(cvVsJobReport([cv])).toBeNull()
    expect(cvVsJobReport([job])).toBeNull()
  })

  it("drops generic ad words and numbers from the gaps", () => {
    expect(
      skillGaps(["vaga", "empresa", "exemplo", "20+", "kubernetes", "avancado"])
    ).toEqual(["kubernetes"])
  })
})
