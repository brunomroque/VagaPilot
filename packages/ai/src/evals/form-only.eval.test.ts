import {
  buildCvHighlightLines,
  normalizeForGrounding,
} from "@vagapilot/core/facts"
import { describe, expect, it } from "vitest"

import { loadEval } from "./load.js"

type Case = {
  id: string
  facts: { id: string; statement: string; usage: "cv_relevant" | "form_only" }[]
  forbidden: string[]
}

const { cases } = loadEval<{ cases: Case[] }>("form-only/cases.json")

/** CHAT-FIRST §5.4 — form_only facts must never appear in CV highlight lines. */
describe("eval: form-only excluded from CV (CHAT-FIRST §5.4)", () => {
  it("form_only statements never appear in CV highlights", () => {
    const failures: string[] = []
    for (const item of cases) {
      const lines = buildCvHighlightLines(item.facts)
      const haystack = normalizeForGrounding(lines.join("\n"))
      for (const phrase of item.forbidden) {
        const needle = normalizeForGrounding(phrase)
        if (needle && haystack.includes(needle)) {
          failures.push(`${item.id}: "${phrase}" leaked into CV highlights`)
        }
      }
      for (const fact of item.facts.filter((f) => f.usage === "cv_relevant")) {
        const needle = normalizeForGrounding(fact.statement)
        if (needle && !haystack.includes(needle)) {
          failures.push(`${item.id}: missing cv_relevant "${fact.statement}"`)
        }
      }
    }
    expect(failures).toEqual([])
    expect(cases.length).toBeGreaterThanOrEqual(4)
  })
})
