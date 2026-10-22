import { describe, expect, it } from "vitest"

import { canStoreDiversityData, isConsentGranted } from "./consents.js"

describe("consents", () => {
  it("CA1.3 diversity data needs a granted 'diversidade' consent", () => {
    expect(canStoreDiversityData([])).toBe(false)
    expect(
      canStoreDiversityData([
        { purpose: "termos", granted: true, createdAt: "2026-10-01T00:00:00Z" },
      ])
    ).toBe(false)
    expect(
      canStoreDiversityData([
        {
          purpose: "diversidade",
          granted: true,
          createdAt: "2026-10-01T00:00:00Z",
        },
      ])
    ).toBe(true)
  })

  it("CA1.3 the latest decision wins (revocation disables storage)", () => {
    const records = [
      {
        purpose: "diversidade",
        granted: true,
        createdAt: "2026-10-01T00:00:00Z",
      },
      {
        purpose: "diversidade",
        granted: false,
        createdAt: new Date("2026-10-02T00:00:00Z"),
      },
    ]
    expect(isConsentGranted(records, "diversidade")).toBe(false)
    expect(isConsentGranted([...records].reverse(), "diversidade")).toBe(false)
  })
})
