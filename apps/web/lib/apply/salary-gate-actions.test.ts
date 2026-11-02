import { describe, expect, it } from "vitest"

import { isSalaryApplyGateOverridden } from "@vagapilot/core/job-rules"

describe("salary gate override (web copy)", () => {
  it("matches the override button label", () => {
    expect(isSalaryApplyGateOverridden("Candidatar mesmo assim")).toBe(true)
  })
})
