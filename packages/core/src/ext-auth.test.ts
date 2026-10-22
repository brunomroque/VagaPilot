import { describe, expect, it } from "vitest"

import {
  generateDeviceToken,
  generatePairingCode,
  hashDeviceToken,
} from "./ext-auth.js"

describe("ext-auth", () => {
  it("CA8.1 generates six-digit pairing codes", () => {
    const code = generatePairingCode()
    expect(code).toMatch(/^\d{6}$/)
  })

  it("hashes device tokens deterministically", () => {
    const token = generateDeviceToken()
    expect(token.startsWith("vp_dev_")).toBe(true)
    expect(hashDeviceToken(token)).toHaveLength(64)
    expect(hashDeviceToken(token)).toBe(hashDeviceToken(token))
  })
})
