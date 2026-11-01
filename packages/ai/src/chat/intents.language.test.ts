import { describe, expect, it } from "vitest"
import { parseSettingsIntent } from "./intents.js"
import { isAllowedNow, policyCheck } from "@vagapilot/core/policy"

describe("QA R18 P1 prefer job language", () => {
  it("prefiro vagas em ingles asks clarification and does not set min_fit", () => {
    const calls = parseSettingsIntent("prefiro vagas em inglês")
    expect(calls.map((c) => c.tool)).toEqual(["ask_clarification"])
    expect(calls.some((c) => c.tool === "set_preference")).toBe(false)
    expect(calls.some((c) => c.tool === "create_saved_search")).toBe(false)
  })

  it("create_saved_search and set_preference need confirmation on user_turn", () => {
    expect(
      isAllowedNow(
        policyCheck({ tool: "create_saved_search", origin: "user_turn" })
      )
    ).toBe(false)
    expect(
      isAllowedNow(policyCheck({ tool: "set_preference", origin: "user_turn" }))
    ).toBe(false)
  })
})
