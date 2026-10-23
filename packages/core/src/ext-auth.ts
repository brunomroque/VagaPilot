import { createHash, randomBytes } from "node:crypto"

const TOKEN_PREFIX = "vp_dev_"

/** Plaintext device token returned once at pairing (11.3). */
export function generateDeviceToken(): string {
  return `${TOKEN_PREFIX}${randomBytes(24).toString("base64url")}`
}

export function hashDeviceToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex")
}

/** Unambiguous alphabet (no 0/1/I/O). 32^8 combinations (spec §11.3). */
export const PAIRING_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
export const PAIRING_CODE_LENGTH = 8
export const PAIRING_MAX_FAILURES = 5
export const PAIRING_IP_MAX_ATTEMPTS = 8
export const PAIRING_IP_WINDOW_MS = 10 * 60 * 1000
export const PAIRING_TTL_MS = 10 * 60 * 1000

const PAIRING_CODE_PATTERN = new RegExp(
  `^[${PAIRING_CODE_ALPHABET}]{${PAIRING_CODE_LENGTH}}$`
)

export function generatePairingCode(): string {
  const bytes = randomBytes(PAIRING_CODE_LENGTH)
  let code = ""
  for (let index = 0; index < PAIRING_CODE_LENGTH; index++) {
    const byte = bytes[index] ?? 0
    code += PAIRING_CODE_ALPHABET[byte % PAIRING_CODE_ALPHABET.length]
  }
  return code
}

export function normalizePairingCode(value: string): string {
  return value.trim().toUpperCase().replace(/[\s-]/g, "")
}

export function isPairingCode(value: string): boolean {
  return PAIRING_CODE_PATTERN.test(value)
}

/**
 * Sliding window counter. The attempt that reaches `max` is limited.
 * Pass `PAIRING_MAX_FAILURES` (5) to burn a code on the 5th miss.
 * Pass `PAIRING_IP_MAX_ATTEMPTS + 1` so 8 requests in the window are allowed.
 */
export function nextAttemptWindow(input: {
  attempts: number
  windowStartedAtMs: number
  nowMs: number
  windowMs: number
  max: number
}): { attempts: number; windowStartedAtMs: number; limited: boolean } {
  const expired =
    input.attempts <= 0 ||
    input.nowMs - input.windowStartedAtMs >= input.windowMs
  const attempts = expired ? 1 : input.attempts + 1
  return {
    attempts,
    windowStartedAtMs: expired ? input.nowMs : input.windowStartedAtMs,
    limited: attempts >= input.max,
  }
}
