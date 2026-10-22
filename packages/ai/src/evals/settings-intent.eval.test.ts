import { isDeepStrictEqual } from "node:util"

import { describe, expect, it } from "vitest"

import { parseSettingsIntent } from "../chat/intents.js"
import { loadEval, pct } from "./load.js"

type Case = {
  text: string
  expected: { tool: string; params: Record<string, unknown> }[]
}

const { cases } = loadEval<{ cases: Case[] }>("settings-intent/phrases.json")

function paramsMatch(
  actual: Record<string, unknown>,
  expected: Record<string, unknown>
): boolean {
  return Object.entries(expected).every(([key, value]) =>
    isDeepStrictEqual(actual[key], value)
  )
}

describe("eval: settings-intent (CA14.1)", () => {
  it("intent and parameter accuracy ≥ 90%", () => {
    let intentOk = 0
    let paramsOk = 0
    const misses: string[] = []
    for (const item of cases) {
      const calls = parseSettingsIntent(item.text)
      const tools = calls.map((call) => call.tool).sort()
      const expectedTools = item.expected.map((call) => call.tool).sort()
      const sameIntent = isDeepStrictEqual(tools, expectedTools)
      if (sameIntent) intentOk += 1
      const sameParams =
        sameIntent &&
        item.expected.every((expected) =>
          calls.some(
            (call) =>
              call.tool === expected.tool &&
              paramsMatch(
                call.input as Record<string, unknown>,
                expected.params
              )
          )
        )
      if (sameParams) paramsOk += 1
      else misses.push(`${item.text} → ${JSON.stringify(calls)}`)
    }
    const intentAccuracy = intentOk / cases.length
    const paramAccuracy = paramsOk / cases.length
    console.info(
      `\n[eval:settings-intent] ${cases.length} frases, intenção ${pct(intentAccuracy)}, parâmetros ${pct(paramAccuracy)}${misses.length ? `\nerros:\n${misses.join("\n")}` : ""}\n`
    )
    expect(intentAccuracy).toBeGreaterThanOrEqual(0.9)
    expect(paramAccuracy).toBeGreaterThanOrEqual(0.9)
  })
})
