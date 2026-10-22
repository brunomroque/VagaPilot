import { describe, expect, it } from "vitest"

import { buildApplyUrl } from "./apply-url.js"

describe("buildApplyUrl (P5.2, CA8.1)", () => {
  it("CA8.1 appends vp_app to apply links", () => {
    const id = "00000000-0000-4000-8000-000000000099"
    expect(buildApplyUrl("https://empresa.gupy.io/jobs/1", id)).toBe(
      "https://empresa.gupy.io/jobs/1?vp_app=00000000-0000-4000-8000-000000000099"
    )
  })
})
