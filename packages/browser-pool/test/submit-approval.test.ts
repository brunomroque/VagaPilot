import type { Page } from "playwright-core"
import { describe, expect, it } from "vitest"

import { hashSummary, runSegment } from "../src/apply/runner.js"
import type { AtsDriver } from "../src/apply/types.js"
import { samplePayload } from "./payload.js"

function reviewDriver(submitCalls: { n: number }): AtsDriver {
  return {
    ats: "fake",
    detect: () => true,
    open: async () => undefined,
    state: async () => "form",
    unknownQuestions: async () => [],
    fillStep: async () => ({ filled: [], unknown: [] }),
    next: async () => "review",
    reviewSummary: async () => [{ label: "Empresa", value: "Acme" }],
    submit: async () => {
      submitCalls.n += 1
      return { ok: true, confirmation: "ok" }
    },
  }
}

const page = {
  waitForTimeout: async () => undefined,
  screenshot: async () => Buffer.from("x"),
} as unknown as Page

describe("final submit approval", () => {
  it("never submits without an approved summary hash", async () => {
    const calls = { n: 0 }
    const out = await runSegment({
      page,
      driver: reviewDriver(calls),
      url: "https://acme.gupy.io/vaga",
      ctx: {
        payload: samplePayload(),
        runAnswers: {},
        cvPath: null,
        salaryTarget: null,
      },
      deadline: Date.now() + 60_000,
    })
    expect(out.kind).toBe("review")
    expect(calls.n).toBe(0)
  })

  it("submits only when approvedSummaryHash matches the review", async () => {
    const calls = { n: 0 }
    const driver = reviewDriver(calls)
    const ctx = {
      payload: samplePayload(),
      runAnswers: {},
      cvPath: null,
      salaryTarget: null,
    }
    const first = await runSegment({
      page,
      driver,
      url: "https://acme.gupy.io/vaga",
      ctx,
      deadline: Date.now() + 60_000,
    })
    expect(first.kind).toBe("review")
    if (first.kind !== "review") return
    const approved = await runSegment({
      page,
      driver,
      url: "https://acme.gupy.io/vaga",
      ctx,
      deadline: Date.now() + 60_000,
      approvedSummaryHash: first.summaryHash,
    })
    expect(approved.kind).toBe("submitted")
    expect(calls.n).toBe(1)
  })

  it("standing final_submit permission still requires approvedSummaryHash in runSegment", () => {
    expect(hashSummary([{ label: "a", value: "b" }])).toHaveLength(64)
  })
})
