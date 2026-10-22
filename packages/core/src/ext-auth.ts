import { createHash, randomBytes } from "node:crypto"

const TOKEN_PREFIX = "vp_dev_"

/** Plaintext device token returned once at pairing (11.3). */
export function generateDeviceToken(): string {
  return `${TOKEN_PREFIX}${randomBytes(24).toString("base64url")}`
}

export function hashDeviceToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex")
}

export function generatePairingCode(): string {
  const n = randomBytes(4).readUInt32BE(0) % 1_000_000
  return n.toString().padStart(6, "0")
}

export const PAIRING_TTL_MS = 10 * 60 * 1000
