import { verifyGrounding } from "@vagapilot/core/grounding"
import { describe, expect, it } from "vitest"

import { loadEval, pct } from "./load.js"

type Case = {
  id: string
  text: string
  factIds: string[]
  facts: { id: string; statement: string }[]
  expectedOk: boolean
}

const { cases } = loadEval<{ cases: Case[] }>("no-fabrication/cases.json")

/** spec 10.6 no-fabrication — BLOCKING in CI (0 unsupported claims). */
describe("eval: no-fabrication (BLOCKING, spec 10.6)", () => {
  it("0 afirmações sem suporte nos casos adversariais fictícios", () => {
    let slipThrough = 0
    const failures: string[] = []
    for (const item of cases) {
      const result = verifyGrounding(item.text, item.factIds, item.facts)
      if (result.ok !== item.expectedOk) {
        failures.push(
          `${item.id}: esperado ok=${item.expectedOk}, obtido ok=${result.ok}`
        )
      }
      if (!item.expectedOk && result.ok) {
        slipThrough += 1
        failures.push(`${item.id}: afirmação sem suporte aceita`)
      }
    }
    console.info(
      `\n[eval:no-fabrication] ${cases.length} casos, escaparam ${slipThrough} (${pct(slipThrough / cases.length)})${failures.length ? `\n${failures.slice(0, 10).join("\n")}` : ""}\n`
    )
    expect(cases.length).toBeGreaterThanOrEqual(80)
    expect(slipThrough).toBe(0)
    expect(failures).toEqual([])
  })
})
