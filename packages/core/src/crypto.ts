import { Buffer } from "node:buffer"
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto"
import process from "node:process"

/**
 * Envelope encryption for `_enc` columns (spec 12.3).
 *
 * Each user has a data-encryption key (DEK, AES-256-GCM). The DEK is stored
 * only in wrapped form, encrypted by a key-encryption key (KEK) held by a
 * `KeyProvider`. Deleting the wrapped DEK makes every ciphertext of that user
 * unrecoverable (crypto-shredding).
 */

export const FIELD_FORMAT_VERSION = 1
export const DEK_BYTES = 32
export const KEK_BYTES = 32
export const DEFAULT_DEK_CACHE_TTL_MS = 5 * 60_000

const IV_BYTES = 12
const TAG_BYTES = 16
const HEADER_BYTES = 1 + IV_BYTES + TAG_BYTES
const ALGORITHM = "aes-256-gcm"

export const KEY_PROVIDER_ENV = "KEY_PROVIDER"
export const LOCAL_KEK_ENV = "KEK_LOCAL"
export const AWS_REGION_ENV = "AWS_REGION"
export const AWS_KMS_KEY_ID_ENV = "AWS_KMS_KEY_ID"

export type CryptoErrorCode =
  | "invalid_kek"
  | "invalid_ciphertext"
  | "unsupported_version"
  | "decrypt_failed"
  | "key_not_found"
  | "provider_not_configured"

export class CryptoError extends Error {
  readonly code: CryptoErrorCode

  constructor(code: CryptoErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = "CryptoError"
    this.code = code
  }
}

export interface KeyProvider {
  /** Identifies the KEK that wrapped a DEK; persisted next to it for rotation. */
  readonly keyId: string
  wrapDek(dek: Uint8Array, userId: string): Promise<Uint8Array>
  unwrapDek(wrappedDek: Uint8Array, userId: string): Promise<Uint8Array>
}

export interface WrappedDekRecord {
  wrappedDek: Uint8Array
  keyId: string
  createdAt: Date
}

export interface DekStore {
  get(userId: string): Promise<WrappedDekRecord | undefined>
  /**
   * Insert-if-absent. Returns the record that ended up stored, which is the
   * existing one when another writer won the race. Never overwrite: replacing
   * a DEK silently orphans every ciphertext written with the previous one.
   */
  put(userId: string, record: WrappedDekRecord): Promise<WrappedDekRecord>
  delete(userId: string): Promise<void>
}

export class InMemoryDekStore implements DekStore {
  private readonly records = new Map<string, WrappedDekRecord>()

  async get(userId: string): Promise<WrappedDekRecord | undefined> {
    return this.records.get(userId)
  }

  async put(
    userId: string,
    record: WrappedDekRecord
  ): Promise<WrappedDekRecord> {
    const existing = this.records.get(userId)
    if (existing) return existing
    this.records.set(userId, record)
    return record
  }

  async delete(userId: string): Promise<void> {
    this.records.delete(userId)
  }

  get size(): number {
    return this.records.size
  }
}

function userAad(purpose: "dek" | "field", userId: string): Buffer {
  return Buffer.from(`vagapilot:${purpose}:v${FIELD_FORMAT_VERSION}:${userId}`)
}

function sealGcm(key: Uint8Array, plaintext: Uint8Array, aad: Buffer): Buffer {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  cipher.setAAD(aad)
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return Buffer.concat([
    Buffer.from([FIELD_FORMAT_VERSION]),
    iv,
    cipher.getAuthTag(),
    ciphertext,
  ])
}

function openGcm(key: Uint8Array, sealed: Uint8Array, aad: Buffer): Buffer {
  if (sealed.length < HEADER_BYTES) {
    throw new CryptoError("invalid_ciphertext", "Ciphertext is too short")
  }
  const version = sealed[0]
  if (version !== FIELD_FORMAT_VERSION) {
    throw new CryptoError(
      "unsupported_version",
      `Unsupported ciphertext version: ${String(version)}`
    )
  }
  const iv = sealed.subarray(1, 1 + IV_BYTES)
  const tag = sealed.subarray(1 + IV_BYTES, HEADER_BYTES)
  const ciphertext = sealed.subarray(HEADER_BYTES)
  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv)
    decipher.setAAD(aad)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()])
  } catch (cause) {
    throw new CryptoError(
      "decrypt_failed",
      "Decryption failed: wrong key, wrong user or tampered data",
      { cause }
    )
  }
}

function decodeKek(base64: string): Buffer {
  const trimmed = base64.trim()
  const decoded = Buffer.from(trimmed, "base64")
  const canonical = decoded.toString("base64")
  if (
    trimmed.length === 0 ||
    canonical.replace(/=+$/, "") !== trimmed.replace(/=+$/, "")
  ) {
    throw new CryptoError("invalid_kek", "KEK must be valid base64")
  }
  return decoded
}

/** Dev/test provider: the KEK comes from the environment (`KEK_LOCAL`). */
export class LocalKeyProvider implements KeyProvider {
  readonly keyId: string
  private readonly kek: Buffer

  constructor(kek: Uint8Array) {
    if (kek.length !== KEK_BYTES) {
      throw new CryptoError(
        "invalid_kek",
        `KEK must be exactly ${KEK_BYTES} bytes, got ${kek.length}`
      )
    }
    this.kek = Buffer.from(kek)
    const fingerprint = createHash("sha256")
      .update(this.kek)
      .digest("hex")
      .slice(0, 16)
    this.keyId = `local:${fingerprint}`
  }

  static fromBase64(base64: string): LocalKeyProvider {
    return new LocalKeyProvider(decodeKek(base64))
  }

  static fromEnv(
    env: Readonly<Record<string, string | undefined>> = process.env
  ): LocalKeyProvider {
    const value = env[LOCAL_KEK_ENV]
    if (!value) {
      throw new CryptoError(
        "invalid_kek",
        `${LOCAL_KEK_ENV} is not set (base64 of ${KEK_BYTES} random bytes)`
      )
    }
    return LocalKeyProvider.fromBase64(value)
  }

  /** Generates a fresh base64 KEK suitable for `KEK_LOCAL`. */
  static generateKekBase64(): string {
    return randomBytes(KEK_BYTES).toString("base64")
  }

  async wrapDek(dek: Uint8Array, userId: string): Promise<Uint8Array> {
    return sealGcm(this.kek, dek, userAad("dek", userId))
  }

  async unwrapDek(wrappedDek: Uint8Array, userId: string): Promise<Uint8Array> {
    return openGcm(this.kek, wrappedDek, userAad("dek", userId))
  }
}

/**
 * Minimal KMS surface used by `AwsKmsKeyProvider`. Adapt `@aws-sdk/client-kms`
 * (`EncryptCommand` / `DecryptCommand`) to this shape where the SDK is installed;
 * core stays dependency-free.
 */
export interface KmsClient {
  encrypt(input: {
    keyId: string
    plaintext: Uint8Array
    encryptionContext: Record<string, string>
  }): Promise<Uint8Array>
  decrypt(input: {
    keyId: string
    ciphertext: Uint8Array
    encryptionContext: Record<string, string>
  }): Promise<Uint8Array>
}

export interface AwsKmsKeyProviderOptions {
  keyId: string
  region?: string
  client?: KmsClient
}

export class AwsKmsKeyProvider implements KeyProvider {
  readonly keyId: string
  readonly region: string | undefined
  private readonly client: KmsClient | undefined

  constructor(options: AwsKmsKeyProviderOptions) {
    this.keyId = options.keyId
    this.region = options.region
    this.client = options.client
  }

  private requireClient(): KmsClient {
    if (!this.client) {
      throw new CryptoError(
        "provider_not_configured",
        "AwsKmsKeyProvider is not configured: inject a KmsClient backed by @aws-sdk/client-kms"
      )
    }
    return this.client
  }

  async wrapDek(dek: Uint8Array, userId: string): Promise<Uint8Array> {
    return this.requireClient().encrypt({
      keyId: this.keyId,
      plaintext: dek,
      encryptionContext: { userId },
    })
  }

  async unwrapDek(wrappedDek: Uint8Array, userId: string): Promise<Uint8Array> {
    return this.requireClient().decrypt({
      keyId: this.keyId,
      ciphertext: wrappedDek,
      encryptionContext: { userId },
    })
  }
}

export type KeyProviderKind = "local" | "aws"

/** Builds the provider named by `KEY_PROVIDER` (defaults to `local`). */
export function keyProviderFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
  options: { kmsClient?: KmsClient } = {}
): KeyProvider {
  const raw = env[KEY_PROVIDER_ENV] || "local"
  if (raw !== "local" && raw !== "aws") {
    throw new CryptoError(
      "provider_not_configured",
      `Unknown ${KEY_PROVIDER_ENV}: ${raw}`
    )
  }
  const kind: KeyProviderKind = raw
  switch (kind) {
    case "local":
      return LocalKeyProvider.fromEnv(env)
    case "aws": {
      const keyId = env[AWS_KMS_KEY_ID_ENV]
      if (!keyId) {
        throw new CryptoError(
          "provider_not_configured",
          `${AWS_KMS_KEY_ID_ENV} is not set`
        )
      }
      return new AwsKmsKeyProvider({
        keyId,
        region: env[AWS_REGION_ENV],
        client: options.kmsClient,
      })
    }
    default: {
      const unreachable: never = kind
      throw new Error(`Unhandled key provider: ${String(unreachable)}`)
    }
  }
}

export interface FieldCryptoOptions {
  keyProvider: KeyProvider
  dekStore: DekStore
  /** How long an unwrapped DEK stays in memory. Keep it short. */
  cacheTtlMs?: number
}

export interface FieldCrypto {
  encryptField(
    userId: string,
    plaintext: string | Uint8Array
  ): Promise<Uint8Array>
  decryptField(userId: string, ciphertext: Uint8Array): Promise<Uint8Array>
  decryptFieldText(userId: string, ciphertext: Uint8Array): Promise<string>
  /** Crypto-shredding: deletes the wrapped DEK and evicts it from the cache. */
  destroyUserKey(userId: string): Promise<void>
  clearCache(): void
}

interface CachedDek {
  dek: Buffer
  expiresAt: number
}

export function createFieldCrypto(options: FieldCryptoOptions): FieldCrypto {
  const { keyProvider, dekStore } = options
  const ttlMs = options.cacheTtlMs ?? DEFAULT_DEK_CACHE_TTL_MS
  const cache = new Map<string, CachedDek>()
  const inflight = new Map<string, Promise<Buffer | undefined>>()

  function evict(userId: string): void {
    const entry = cache.get(userId)
    if (entry) {
      entry.dek.fill(0)
      cache.delete(userId)
    }
  }

  function readCache(userId: string): Buffer | undefined {
    const entry = cache.get(userId)
    if (!entry) return undefined
    if (Date.now() >= entry.expiresAt) {
      evict(userId)
      return undefined
    }
    return entry.dek
  }

  function remember(userId: string, dek: Buffer): Buffer {
    if (ttlMs > 0) {
      cache.set(userId, { dek, expiresAt: Date.now() + ttlMs })
    }
    return dek
  }

  async function unwrap(
    userId: string,
    record: WrappedDekRecord
  ): Promise<Buffer> {
    try {
      const dek = Buffer.from(
        await keyProvider.unwrapDek(record.wrappedDek, userId)
      )
      if (dek.length !== DEK_BYTES) {
        throw new CryptoError(
          "decrypt_failed",
          "Unwrapped DEK has wrong length"
        )
      }
      return dek
    } catch (error) {
      if (error instanceof CryptoError) throw error
      throw new CryptoError("decrypt_failed", "Could not unwrap user DEK", {
        cause: error,
      })
    }
  }

  async function loadDek(
    userId: string,
    create: boolean
  ): Promise<Buffer | undefined> {
    const cached = readCache(userId)
    if (cached) return cached

    const key = `${create ? "w" : "r"}:${userId}`
    const pending = inflight.get(key)
    if (pending) return pending

    const work = (async () => {
      const existing = await dekStore.get(userId)
      if (existing) return remember(userId, await unwrap(userId, existing))
      if (!create) return undefined

      const fresh = randomBytes(DEK_BYTES)
      const stored = await dekStore.put(userId, {
        wrappedDek: await keyProvider.wrapDek(fresh, userId),
        keyId: keyProvider.keyId,
        createdAt: new Date(),
      })
      return remember(userId, await unwrap(userId, stored))
    })()

    inflight.set(key, work)
    try {
      return await work
    } finally {
      inflight.delete(key)
    }
  }

  async function requireDek(userId: string): Promise<Buffer> {
    const dek = await loadDek(userId, false)
    if (!dek) {
      throw new CryptoError("key_not_found", "No encryption key for this user")
    }
    return dek
  }

  return {
    async encryptField(userId, plaintext) {
      const dek = await loadDek(userId, true)
      if (!dek) {
        throw new CryptoError(
          "key_not_found",
          "No encryption key for this user"
        )
      }
      const bytes =
        typeof plaintext === "string"
          ? Buffer.from(plaintext, "utf8")
          : plaintext
      return new Uint8Array(sealGcm(dek, bytes, userAad("field", userId)))
    },

    async decryptField(userId, ciphertext) {
      const dek = await requireDek(userId)
      return new Uint8Array(openGcm(dek, ciphertext, userAad("field", userId)))
    },

    async decryptFieldText(userId, ciphertext) {
      const dek = await requireDek(userId)
      return openGcm(dek, ciphertext, userAad("field", userId)).toString("utf8")
    },

    async destroyUserKey(userId) {
      evict(userId)
      await dekStore.delete(userId)
      evict(userId)
    },

    clearCache() {
      for (const userId of [...cache.keys()]) evict(userId)
    },
  }
}
