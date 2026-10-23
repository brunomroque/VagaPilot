import type { Page } from "playwright-core"
import { describe, expect, it, vi } from "vitest"

import { decide, EMPTY_PERMISSIONS, type PermissionState } from "../src/apply/permissions.js"
import { runSegment } from "../src/apply/runner.js"
import type { AtsDriver } from "../src/apply/types.js"
import { samplePayload } from "./payload.js"

function signupDriver() {
  let signedUp = false
  const driver: AtsDriver = {
    ats: "fake",
    detect: () => true,
    open: async () => undefined,
    state: async () => (signedUp ? "done" : "signup"),
    unknownQuestions: async () => [],
    fillStep: async () => ({ filled: [], unknown: [] }),
    next: async () => "review",
    reviewSummary: async () => [],
    submit: async () => ({ ok: true, confirmation: null }),
    signup: async () => {
      signedUp = true
      return true
    },
  }
  return driver
}

const page = { waitForTimeout: async () => undefined } as unknown as Page

function input(permit: () => Promise<"allow" | "ask" | "deny">) {
  const create = vi.fn(async () => ({ email: "a@b.c", password: "x", created: true }))
  return {
    create,
    segment: {
      page,
      driver: signupDriver(),
      url: "https://acme.gupy.io/vaga",
      ctx: { payload: samplePayload(), runAnswers: {}, cvPath: null },
      deadline: Date.now() + 60_000,
      humanWaitMs: 0,
      account: { get: async () => null, create },
      permit,
    },
  }
}

describe("runner permission gate", () => {
  it("asks before creating a site account", async () => {
    const { segment, create } = input(async () => "ask")
    const out = await runSegment(segment as never)
    expect(out.kind).toBe("needs_answers")
    if (out.kind !== "needs_answers") return
    expect(out.questions[0]?.permission).toEqual({ action: "create_site_account" })
    expect(create).not.toHaveBeenCalled()
  })
  it("creates the account when permitted", async () => {
    const { segment, create } = input(async () => "allow")
    await runSegment(segment as never)
    expect(create).toHaveBeenCalledOnce()
  })
  it("hands over to the human when denied", async () => {
    const { segment, create } = input(async () => "deny")
    const out = await runSegment(segment as never)
    expect(create).not.toHaveBeenCalled()
    expect(out.kind).not.toBe("needs_answers")
  })
})

describe("decide", () => {
  it("marketing default deny asks instead of failing the run", () => {
    expect(decide(EMPTY_PERMISSIONS, "accept_marketing_optin", "x.com", ["marketing"]).decision).toBe("ask")
    const explicit: PermissionState = {
      ...EMPTY_PERMISSIONS,
      settings: { accept_marketing_optin: { mode: "deny" } },
      explicit: new Set(["accept_marketing_optin"]),
    }
    expect(decide(explicit, "accept_marketing_optin", "x.com", ["marketing"]).decision).toBe("deny")
  })
  it("admin high-risk level blocks auto", () => {
    const s: PermissionState = {
      ...EMPTY_PERMISSIONS,
      siteRisk: "alto",
      settings: { accept_site_terms: { mode: "auto", categories: ["termos"] } },
    }
    expect(decide(s, "accept_site_terms", "x.com", ["termos"]).reason).toBe("high_risk_site")
  })
})
