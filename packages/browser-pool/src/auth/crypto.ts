import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

/**
 * AES-256-GCM sealing for saved login sessions (Playwright storageState), keyed by the
 * server-side env var AUTH_STATE_ENCRYPTION_KEY (32 bytes, base64 or hex). The AAD binds each
 * ciphertext to its user + site + provider so a row can't be swapped into another account.
 *
 * Layout: "VPA1" (4) | iv (12) | tag (16) | ciphertext. Legacy rows (sealed with the user DEK by
 * the first apply runner) start with byte 0x01 and are still readable through the field crypto.
 */
export const AUTH_STATE_KEY_ENV = "AUTH_STATE_ENCRYPTION_KEY"
const MAGIC = Buffer.from("VPA1", "ascii")
const IV = 12
const TAG = 16

type Env = Record<string, string | undefined>

export class AuthStateKeyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AuthStateKeyError"
  }
}

export function authStateKeyFromEnv(env: Env = process.env): Buffer | null {
  const raw = env[AUTH_STATE_KEY_ENV]?.trim()
  if (!raw) return null
  const key = /^[0-9a-f]{64}$/i.test(raw)
    ? Buffer.from(raw, "hex")
    : Buffer.from(raw, "base64")
  if (key.length !== 32)
    throw new AuthStateKeyError(
      `${AUTH_STATE_KEY_ENV} must be 32 bytes (base64 or hex).`
    )
  return key
}

export function authAad(
  userId: string,
  site: string,
  provider: string
): Buffer {
  return Buffer.from(`vp-auth|${userId}|${site}|${provider}`, "utf8")
}

export function isSealedAuthState(
  bytes: Uint8Array | null | undefined
): boolean {
  return Boolean(
    bytes &&
    bytes.length > MAGIC.length + IV + TAG &&
    Buffer.from(bytes.subarray(0, 4)).equals(MAGIC)
  )
}

export function sealAuthState(
  key: Buffer,
  aad: Buffer,
  value: unknown
): Buffer {
  const iv = randomBytes(IV)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  cipher.setAAD(aad)
  const body = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ])
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), body])
}

export function openAuthState<T = unknown>(
  key: Buffer,
  aad: Buffer,
  sealed: Uint8Array
): T {
  if (!isSealedAuthState(sealed))
    throw new AuthStateKeyError("Not a sealed auth state.")
  const buf = Buffer.from(sealed)
  const iv = buf.subarray(4, 4 + IV)
  const tag = buf.subarray(4 + IV, 4 + IV + TAG)
  const decipher = createDecipheriv("aes-256-gcm", key, iv)
  decipher.setAAD(aad)
  decipher.setAuthTag(tag)
  const text = Buffer.concat([
    decipher.update(buf.subarray(4 + IV + TAG)),
    decipher.final(),
  ]).toString("utf8")
  return JSON.parse(text) as T
}
