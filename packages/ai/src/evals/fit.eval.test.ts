import { randomUUID } from "node:crypto"

import {
  computeJobAlerts,
  type FitLevelValue,
  type JobForAlerts,
  type ProfileForAlerts,
} from "@vagapilot/core/job-rules"
import { describe, expect, it } from "vitest"

import { assessFit } from "../assess-fit.js"
import { loadEval, pct } from "./load.js"

type Pair = {
  id: string
  expectedFit: FitLevelValue
  job: JobForAlerts & {
    title: string
    requirementsRequired: string[]
    requirementsPreferred: string[]
    language: "pt-BR" | "en" | "es"
  }
  profile: Omit<ProfileForAlerts, "homeCity"> & {
    facts: { statement: string; kind: string; tags: string[] }[]
  }
}

const { pairs } = loadEval<{ pairs: Pair[] }>("fit/pairs.json")

/** evals/fit (P2.3, spec 10.6): fake provider by default; set AI_GATEWAY_API_KEY to run a model. */
describe("eval: fit concordance", () => {
  it("CA6.1 starter set: concordance ≥ 80% with the hand labels", async () => {
    const rows: string[] = []
    let agree = 0
    for (const pair of pairs) {
      const codeAlerts = computeJobAlerts(pair.job, {
        ...pair.profile,
        homeCity: null,
      })
      const result = await assessFit({
        job: { ...pair.job, company: null },
        facts: pair.profile.facts.map((fact) => ({
          ...fact,
          id: randomUUID(),
        })),
        codeAlerts,
        tracks: [],
      })
      const ok = result.assessment.fit === pair.expectedFit
      if (ok) agree += 1
      rows.push(
        `${ok ? "✓" : "✗"} ${pair.id}: esperado ${pair.expectedFit}, obtido ${result.assessment.fit} (score ${result.assessment.score}, modelo ${result.model})`
      )
    }
    const concordance = agree / pairs.length
    console.info(
      `\n[eval:fit] ${pairs.length} pares, concordância ${pct(concordance)}\n${rows.join("\n")}\n`
    )
    expect(pairs.length).toBeGreaterThanOrEqual(50)
    expect(concordance).toBeGreaterThanOrEqual(0.8)
  })
})
