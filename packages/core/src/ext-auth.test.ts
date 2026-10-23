import { describe, expect, it } from "vitest"

import {
  generateDeviceToken,
  generatePairingCode,
  hashDeviceToken,
  isPairingCode,
  nextAttemptWindow,
  PAIRING_CODE_ALPHABET,
  PAIRING_MAX_FAILURES,
  PAIRING_IP_MAX_ATTEMPTS,
} from "./ext-auth.js"

describe("ext-auth", () => {
  it("CA8.1 generates an 8-character unambiguous pairing code", () => {
    const code = generatePairingCode()
    expect(code).toHaveLength(8)
    expect(isPairingCode(code)).toBe(true)
    expect(code).not.toMatch(/[01IO]/)
    for (const char of code) {
      expect(PAIRING_CODE_ALPHABET.includes(char)).toBe(true)
    }
  })

  it("locks a code on the 5th miss and allows 8 IP attempts", () => {
    let attempts = 0
    let started = 0
    let limitedAt = 0
    for (let index = 0; index < 6; index++) {
      const next = nextAttemptWindow({
        attempts,
        windowStartedAtMs: started,
        nowMs: 1_000 + index,
        windowMs: 60_000,
        max: PAIRING_MAX_FAILURES,
      })
      attempts = next.attempts
      started = next.windowStartedAtMs
      if (next.limited) {
        limitedAt = next.attempts
        break
      }
    }
    expect(limitedAt).toBe(5)

    attempts = 0
    started = 0
    let ipLimited = false
    for (let index = 0; index < 10; index++) {
      const next = nextAttemptWindow({
        attempts,
        windowStartedAtMs: started,
        nowMs: 1_000 + index,
        windowMs: 60_000,
        max: PAIRING_IP_MAX_ATTEMPTS + 1,
      })
      attempts = next.attempts
      started = next.windowStartedAtMs
      if (next.limited) {
        ipLimited = true
        expect(next.attempts).toBe(9)
        break
      }
    }
    expect(ipLimited).toBe(true)

    const reset = nextAttemptWindow({
      attempts: 8,
      windowStartedAtMs: 0,
      nowMs: 11 * 60 * 1000,
      windowMs: 10 * 60 * 1000,
      max: PAIRING_IP_MAX_ATTEMPTS + 1,
    })
    expect(reset.attempts).toBe(1)
    expect(reset.limited).toBe(false)
  })

  it("hashes device tokens deterministically", () => {
    const token = generateDeviceToken()
    expect(token.startsWith("vp_dev_")).toBe(true)
    expect(hashDeviceToken(token)).toHaveLength(64)
    expect(hashDeviceToken(token)).toBe(hashDeviceToken(token))
  })
})
