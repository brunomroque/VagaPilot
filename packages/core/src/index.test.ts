import { describe, expect, it } from "vitest"

import { isCorePackageReady } from "./index.js"

describe("core foundation", () => {
  it("exposes the package entry used by later phases", () => {
    expect(isCorePackageReady()).toBe(true)
  })
})
