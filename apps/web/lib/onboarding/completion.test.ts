import { describe, expect, it } from "vitest"

import { profileCompletionPercent } from "./completion"
import type { OnboardingRequirements } from "./server"

const empty: OnboardingRequirements = {
  hasCv: false,
  hasSalaryRule: false,
  hasLanguage: false,
  hasWorkModels: false,
  hasRegimes: false,
  hasAvailability: false,
}

describe("profileCompletionPercent", () => {
  it("returns 0 when nothing is done", () => {
    expect(profileCompletionPercent(empty)).toBe(0)
  })

  it("returns 100 when all requirements are met", () => {
    expect(
      profileCompletionPercent({
        hasCv: true,
        hasSalaryRule: true,
        hasLanguage: true,
        hasWorkModels: true,
        hasRegimes: true,
        hasAvailability: true,
      })
    ).toBe(100)
  })

  it("rounds partial completion", () => {
    expect(profileCompletionPercent({ ...empty, hasCv: true })).toBe(17)
  })
})
