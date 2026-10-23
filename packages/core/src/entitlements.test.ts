import { describe, expect, it } from "vitest"

import {
  checkAndIncrementUsage,
  effectivePlan,
  limitsForPlan,
  proTrialStillAvailable,
  searchPassPeriodEndIso,
  subscriptionPeriodEndIso,
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

  it("expires a search pass and ignores NaN period ends", () => {
    const start = 1_700_000_000
    const end = searchPassPeriodEndIso(start)
    expect(new Date(end).getTime() - start * 1000).toBe(
      90 * 24 * 60 * 60 * 1000
    )
    expect(
      effectivePlan({
        plan: "search_pass",
        status: "active",
        currentPeriodEnd: end,
        now: new Date(start * 1000 + 1_000),
      })
    ).toBe("search_pass")
    expect(
      effectivePlan({
        plan: "search_pass",
        status: "active",
        currentPeriodEnd: end,
        now: new Date(start * 1000 + 91 * 24 * 60 * 60 * 1000),
      })
    ).toBe("free")
    expect(
      subscriptionPeriodEndIso({
        itemPeriodEnd: 1_700_000_100,
        currentPeriodEnd: Number.NaN,
      })
    ).toBe(new Date(1_700_000_100 * 1000).toISOString())
    expect(
      subscriptionPeriodEndIso({
        itemPeriodEnd: Number.NaN,
        currentPeriodEnd: Number.NaN,
      })
    ).toBeNull()
  })

  it("gives the Pro trial only once", () => {
    expect(
      proTrialStillAvailable({
        plan: "free",
        status: null,
        stripeSubscriptionId: null,
        priorSubscriptionCount: 0,
      })
    ).toBe(true)
    expect(
      proTrialStillAvailable({
        plan: "pro",
        status: "canceled",
        stripeSubscriptionId: "sub_x",
        priorSubscriptionCount: 1,
      })
    ).toBe(false)
    expect(
      proTrialStillAvailable({
        plan: "free",
        status: null,
        stripeSubscriptionId: null,
        priorSubscriptionCount: -1,
      })
    ).toBe(false)
    expect(
      proTrialStillAvailable({
        plan: "search_pass",
        status: "active",
        stripeSubscriptionId: null,
        priorSubscriptionCount: 0,
      })
    ).toBe(true)
  })
})
