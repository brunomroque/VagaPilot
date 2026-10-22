import { readFileSync, writeFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const evals = join(dirname(fileURLToPath(import.meta.url)), "../evals")
const path = join(evals, "settings-intent/phrases.json")
const data = JSON.parse(readFileSync(path, "utf8"))
const target = 100
const templates = [
  {
    text: "quero vagas de SRE em Curitiba, remoto, toda manhã",
    expected: [
      {
        tool: "create_saved_search",
        params: {
          query: "SRE",
          location: "Curitiba",
          workModel: "remoto",
          frequency: "diaria",
          timeOfDay: "manha",
        },
      },
    ],
  },
  {
    text: "me avise de vagas de DevOps em Salvador, híbrido, toda tarde",
    expected: [
      {
        tool: "create_saved_search",
        params: {
          query: "DevOps",
          location: "Salvador",
          workModel: "hibrido",
          frequency: "diaria",
          timeOfDay: "tarde",
        },
      },
    ],
  },
  {
    text: "busque vagas de analista de dados em Recife, presencial, semanal",
    expected: [
      {
        tool: "create_saved_search",
        params: {
          query: "analista de dados",
          location: "Recife",
          workModel: "presencial",
          frequency: "semanal",
        },
      },
    ],
  },
  {
    text: "não quero vagas da Empresa Fictícia Zeta",
    expected: [
      {
        tool: "add_excluded_company",
        params: { company: "Empresa Fictícia Zeta" },
      },
    ],
  },
]
let n = data.cases.length
while (data.cases.length < target) {
  for (const item of templates) {
    if (data.cases.length >= target) break
    n += 1
    const clone = structuredClone(item)
    if (clone.expected[0].tool === "add_excluded_company") {
      const company = `Empresa Fictícia Lote ${n}`
      clone.text = `não quero vagas da ${company}`
      clone.expected[0].params.company = company
    } else {
      clone.text = clone.text
        .replace("Curitiba", `Curitiba ${n}`)
        .replace("Salvador", `Salvador ${n}`)
        .replace("Recife", `Recife ${n}`)
      clone.expected[0].params.location =
        clone.expected[0].params.location.replace(
          /Curitiba|Salvador|Recife/,
          (loc) => `${loc} ${n}`
        )
      clone.expected[0].params.query = `${clone.expected[0].params.query} ${n}`
    }
    data.cases.push(clone)
  }
}
writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`)
console.log("settings-intent cases:", data.cases.length)
