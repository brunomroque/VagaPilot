import { describe, expect, it } from "vitest"

import { cvQualityScore, cvQualityText } from "./cv-quality"

const GOOD = `Maria Silva
maria@example.com | +55 11 99999-0000 | https://linkedin.com/in/maria
Resumo
Analista de dados com 6 anos de experiência.
Experiência
Empresa A — Analista de Dados (03/2020 – atual)
- Reduzi o tempo de relatórios em 40%
- Automatizei 12 dashboards para 300 clientes
- Liderei migração para BigQuery
Empresa B — Analista (2017 – 2020)
Formação
Bacharelado em Estatística, USP, 2016
Competências
SQL, Python, Power BI
Idiomas
Inglês avançado
${"Detalhes adicionais sobre projetos e resultados. ".repeat(40)}`

describe("cvQualityScore", () => {
  it("is deterministic and scores a complete CV high", () => {
    const a = cvQualityScore(GOOD)
    expect(a).toEqual(cvQualityScore(GOOD))
    expect(a.score).toBeGreaterThanOrEqual(80)
  })
  it("scores a bare CV low and lists gaps", () => {
    const q = cvQualityScore("João\nVendedor na loja X")
    expect(q.score).toBeLessThan(40)
    expect(q.gaps.length).toBeGreaterThan(5)
  })
  it("text always carries the score", () => {
    expect(cvQualityText("cv.pdf", GOOD)).toMatch(/\d+\/100/)
  })
})
