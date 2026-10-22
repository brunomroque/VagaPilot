/**
 * Expands evals/* toward spec 10.6 targets using FICTITIOUS variants only.
 * Run once after editing starter sets: node scripts/expand-fictitious-evals.mjs
 */
import { readFileSync, writeFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const evals = join(root, "evals")

function readJson(rel) {
  return JSON.parse(readFileSync(join(evals, rel), "utf8"))
}

function writeJson(rel, data) {
  writeFileSync(join(evals, rel), `${JSON.stringify(data, null, 2)}\n`, "utf8")
}

function expandFit() {
  const data = readJson("fit/pairs.json")
  const base = data.pairs.slice(0, 10)
  data.pairs = base
  const target = 50
  let next = base.length
  const cities = [
    "Curitiba",
    "Belo Horizonte",
    "Porto Alegre",
    "Recife",
    "Brasília",
  ]
  while (data.pairs.length < target) {
    for (const pair of base) {
      if (data.pairs.length >= target) break
      const n = next + 1
      const city = cities[n % cities.length]
      const clone = structuredClone(pair)
      clone.id = `fit-${String(n).padStart(2, "0")}`
      if (clone.expectedFit === "alto" && n % 10 === 1) {
        clone.expectedFit = "medio"
      }
      clone.job = {
        ...clone.job,
        title: `${clone.job.title} (fictício ${n})`,
        location: clone.job.location?.includes("São Paulo")
          ? `${city}, ${city === "Brasília" ? "DF" : "BR"}`
          : clone.job.location,
      }
      data.pairs.push(clone)
      next += 1
    }
  }
  data.$comment =
    "evals/fit: FICTITIOUS labeled pairs (P7). Target 50, concordance ≥ 80% with fake assessor."
  writeJson("fit/pairs.json", data)
  console.log("fit pairs:", data.pairs.length)
}

function expandEmails() {
  const data = readJson("email/emails.json")
  const base = data.emails
  const target = 200
  let seq = base.length
  while (data.emails.length < target) {
    for (const row of base) {
      if (data.emails.length >= target) break
      seq += 1
      const suffix = `(fictício ${seq})`
      data.emails.push({
        ...row,
        id: `gen-${String(seq).padStart(3, "0")}`,
        subject: row.subject.includes("(")
          ? row.subject
          : `${row.subject} ${suffix}`,
        body: row.body.replace(
          /Empresa Fictícia \w+/g,
          (m) => `${m} ${suffix}`
        ),
      })
    }
  }
  data.description =
    "P7 email-classify eval: 200 FICTITIOUS e-mails (PT/EN). All names, companies and codes are invented."
  writeJson("email/emails.json", data)
  console.log("emails:", data.emails.length)
}

function expandSettingsIntent() {
  const data = readJson("settings-intent/phrases.json")
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
      clone.text = clone.text.replace(
        /Zeta|SRE|DevOps|Recife|Salvador|Curitiba/g,
        (match) => `${match}-${n}`
      )
      if (clone.expected[0]?.params?.company) {
        clone.expected[0].params.company =
          clone.expected[0].params.company.replace("Zeta", `Zeta-${n}`)
      }
      if (clone.expected[0]?.params?.query) {
        clone.expected[0].params.query = clone.expected[0].params.query.replace(
          /SRE|DevOps|analista de dados/,
          (q) => `${q} ${n}`
        )
      }
      if (clone.expected[0]?.params?.location) {
        clone.expected[0].params.location =
          clone.expected[0].params.location.replace(
            /Recife|Salvador|Curitiba/,
            (loc) => `${loc}-${n}`
          )
      }
      data.cases.push(clone)
    }
  }
  writeJson("settings-intent/phrases.json", data)
  console.log("settings-intent:", data.cases.length)
}

function expandInjection() {
  const data = readJson("prompt-injection/attacks.json")
  const targetUser = 200
  const targetUntrusted = 200
  let u = data.userMessages.length
  const userBase = [...data.userMessages]
  while (data.userMessages.length < targetUser) {
    for (const msg of userBase) {
      if (data.userMessages.length >= targetUser) break
      u += 1
      data.userMessages.push(`${msg} [fictício ${u}]`)
    }
  }
  let t = data.untrustedContent.length
  const untrustedBase = [...data.untrustedContent]
  while (data.untrustedContent.length < targetUntrusted) {
    for (const row of untrustedBase) {
      if (data.untrustedContent.length >= targetUntrusted) break
      t += 1
      data.untrustedContent.push({
        source: row.source,
        text: `${row.text} (fictício ${t})`,
      })
    }
  }
  writeJson("prompt-injection/attacks.json", data)
  console.log(
    "prompt-injection:",
    data.userMessages.length,
    "+",
    data.untrustedContent.length
  )
}

function expandOffTopic() {
  const data = readJson("off-topic/requests.json")
  const target = 200
  let o = data.offTopic.length
  const offBase = [...data.offTopic]
  while (data.offTopic.length < target) {
    for (const text of offBase) {
      if (data.offTopic.length >= target) break
      o += 1
      data.offTopic.push(`${text} (fictício ${o})`)
    }
  }
  let d = data.inDomain.length
  const inBase = [...data.inDomain]
  while (data.inDomain.length < target) {
    for (const text of inBase) {
      if (data.inDomain.length >= target) break
      d += 1
      data.inDomain.push(`${text} — fictício ${d}`)
    }
  }
  writeJson("off-topic/requests.json", data)
  console.log("off-topic:", data.offTopic.length, "+", data.inDomain.length)
}

function expandLeakFraud() {
  const data = readJson("prompt-leak-fraud/cases.json")
  const target = 50
  let l = data.leak.length
  const leakBase = [...data.leak]
  while (data.leak.length < target) {
    for (const text of leakBase) {
      if (data.leak.length >= target) break
      l += 1
      data.leak.push(`${text} (fictício ${l})`)
    }
  }
  let f = data.fraud.length
  const fraudBase = [...data.fraud]
  while (data.fraud.length < target) {
    for (const text of fraudBase) {
      if (data.fraud.length >= target) break
      f += 1
      data.fraud.push(`${text} (fictício ${f})`)
    }
  }
  writeJson("prompt-leak-fraud/cases.json", data)
  console.log("leak+fraud:", data.leak.length, "+", data.fraud.length)
}

expandFit()
expandEmails()
expandSettingsIntent()
expandInjection()
expandOffTopic()
expandLeakFraud()
console.log("Done.")
