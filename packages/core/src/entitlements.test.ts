import { describe, expect, it } from "vitest"

import {
  checkAndIncrementUsage,
  limitsForPlan,
  usagePeriod,
} from "./entitlements.js"

describe("entitlements (§14, P6.3)", () => {
  it("CA6.3 free plan blocks Gmail and the 16th analysis", () => {
    const free = limitsForPlan("free")
    expect(free.gmail).toBe(false)
    expect(free.jobAnalysesPerMonth).toBe(15)
    expect(
      checkAndIncrementUsage({
        plan: "free",
        metric: "job_analyses",
        current: 15,
        increment: 1,
      })
    ).toEqual({ ok: false, code: "limit_exceeded", limit: 15 })
  })

  it("uses month period for analyses and day period for LLM cost", () => {
    const at = new Date("2026-10-22T12:00:00.000Z")
    expect(usagePeriod("job_analyses", at)).toBe("2026-10")
    expect(usagePeriod("llm_cost_cents", at)).toBe("2026-10-22")
  })

  it("pro plan allows Gmail and 200 analyses", () => {
    const pro = limitsForPlan("pro")
    expect(pro.gmail).toBe(true)
    expect(
      checkAndIncrementUsage({
        plan: "pro",
        metric: "job_analyses",
        current: 199,
        increment: 1,
      }).ok
    ).toBe(true)
  })
})
