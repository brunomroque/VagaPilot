/**
 * Generates evals/no-fabrication/cases.json — 80 FICTITIOUS adversarial grounding cases.
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const out = join(
  dirname(fileURLToPath(import.meta.url)),
  "../evals/no-fabrication/cases.json"
)

const facts = [
  {
    id: "f-k8s",
    statement: "Liderei migração de 40 serviços para Kubernetes em produção",
  },
  { id: "f-go", statement: "Construí serviços backend em Go para pagamentos" },
  { id: "f-pg", statement: "Administrei PostgreSQL em produção" },
  {
    id: "f-lead",
    statement: "Liderança de times de engenharia com 12 pessoas",
  },
  { id: "f-otel", statement: "Implantei observabilidade com OpenTelemetry" },
]

const cases = []
let n = 0

function add(caseDef) {
  n += 1
  cases.push({ id: `nf-${String(n).padStart(2, "0")}`, ...caseDef })
}

for (const fact of facts) {
  add({
    text: fact.statement,
    factIds: [fact.id],
    facts: [fact],
    expectedOk: true,
  })
}

for (let i = 0; i < 25; i += 1) {
  add({
    text: `Sou especialista em blockchain há ${10 + i} anos na Empresa Fictícia ${i}`,
    factIds: ["f-k8s"],
    facts: [facts[0]],
    expectedOk: false,
  })
}

for (let i = 0; i < 20; i += 1) {
  add({
    text: `Tenho certificação PMP e domino Rust (fictício ${i})`,
    factIds: [],
    facts: facts.slice(0, 3),
    expectedOk: false,
  })
}

for (let i = 0; i < 15; i += 1) {
  add({
    text: "",
    factIds: [],
    facts: [],
    expectedOk: true,
  })
}

for (let i = 0; i < 15; i += 1) {
  const fact = facts[i % facts.length]
  add({
    text: "   ",
    factIds: [fact.id],
    facts: [fact],
    expectedOk: true,
  })
}

while (cases.length < 80) {
  add({
    text: "Mentoria de carreira para estagiários",
    factIds: ["f-lead"],
    facts: [facts[3]],
    expectedOk: false,
  })
}

mkdirSync(dirname(out), { recursive: true })
writeFileSync(
  out,
  `${JSON.stringify(
    {
      $comment:
        "evals/no-fabrication (spec 10.6, BLOCKING): 0 unsupported claims. FICTITIOUS only.",
      cases: cases.slice(0, 80),
    },
    null,
    2
  )}\n`,
  "utf8"
)
console.log("wrote", out, "cases:", Math.min(cases.length, 80))
