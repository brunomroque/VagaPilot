import { Buffer } from "node:buffer"
import { randomBytes } from "node:crypto"

import { afterEach, describe, expect, it, vi } from "vitest"

import {
  AwsKmsKeyProvider,
  CryptoError,
  createFieldCrypto,
  InMemoryDekStore,
  keyProviderFromEnv,
  LocalKeyProvider,
  type KeyProvider,
  type KmsClient,
} from "./crypto.js"

const USER_A = "00000000-0000-4000-8000-00000000000a"
const USER_B = "00000000-0000-4000-8000-00000000000b"

function setup(options: { cacheTtlMs?: number; provider?: KeyProvider } = {}) {
  const keyProvider = options.provider ?? new LocalKeyProvider(randomBytes(32))
  const dekStore = new InMemoryDekStore()
  const crypto = createFieldCrypto({
    keyProvider,
    dekStore,
    cacheTtlMs: options.cacheTtlMs,
  })
  return { keyProvider, dekStore, crypto }
}

async function expectCode(
  promise: Promise<unknown>,
  code: CryptoError["code"]
) {
  await expect(promise).rejects.toBeInstanceOf(CryptoError)
  await expect(promise).rejects.toMatchObject({ code })
}

afterEach(() => {
  vi.useRealTimers()
})

describe("encryptField / decryptField", () => {
  it("round-trips strings", async () => {
    const { crypto } = setup()
    const plaintext = "Pretensão: R$ 12.000 — Ana Fictícia"
    const sealed = await crypto.encryptField(USER_A, plaintext)
    expect(Buffer.from(sealed).toString("utf8")).not.toContain("Ana")
    expect(await crypto.decryptFieldText(USER_A, sealed)).toBe(plaintext)
  })

  it("round-trips bytes", async () => {
    const { crypto } = setup()
    const bytes = new Uint8Array([0, 1, 2, 250, 255])
    const sealed = await crypto.encryptField(USER_A, bytes)
    expect(await crypto.decryptField(USER_A, sealed)).toEqual(bytes)
  })

  it("uses the versioned layout version + iv + tag + ciphertext", async () => {
    const { crypto } = setup()
    const sealed = await crypto.encryptField(USER_A, "abc")
    expect(sealed[0]).toBe(1)
    expect(sealed.length).toBe(1 + 12 + 16 + 3)
  })

  it("uses a fresh IV per encryption", async () => {
    const { crypto } = setup()
    const a = await crypto.encryptField(USER_A, "same")
    const b = await crypto.encryptField(USER_A, "same")
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false)
  })

  it("creates a single DEK per user and stores it wrapped", async () => {
    const { crypto, dekStore, keyProvider } = setup()
    await Promise.all([
      crypto.encryptField(USER_A, "1"),
      crypto.encryptField(USER_A, "2"),
    ])
    expect(dekStore.size).toBe(1)
    const record = await dekStore.get(USER_A)
    expect(record?.keyId).toBe(keyProvider.keyId)
    expect(record?.wrappedDek.length).toBe(1 + 12 + 16 + 32)
  })

  it("rejects ciphertext of user A decrypted as user B", async () => {
    const { crypto } = setup()
    const sealed = await crypto.encryptField(USER_A, "segredo")
    await crypto.encryptField(USER_B, "outro")
    await expectCode(crypto.decryptField(USER_B, sealed), "decrypt_failed")
  })

  it("rejects decryption for a user without a key", async () => {
    const { crypto } = setup()
    const sealed = await crypto.encryptField(USER_A, "segredo")
    await expectCode(crypto.decryptField(USER_B, sealed), "key_not_found")
  })

  it("rejects tampered ciphertext, tag and iv", async () => {
    const { crypto } = setup()
    const sealed = await crypto.encryptField(USER_A, "segredo")
    for (const index of [1, 13, sealed.length - 1]) {
      const tampered = new Uint8Array(sealed)
      tampered[index] = (tampered[index] ?? 0) ^ 0x01
      await expectCode(crypto.decryptField(USER_A, tampered), "decrypt_failed")
    }
  })

  it("rejects unknown versions and truncated input", async () => {
    const { crypto } = setup()
    const sealed = await crypto.encryptField(USER_A, "segredo")
    const wrongVersion = new Uint8Array(sealed)
    wrongVersion[0] = 2
    await expectCode(
      crypto.decryptField(USER_A, wrongVersion),
      "unsupported_version"
    )
    await expectCode(
      crypto.decryptField(USER_A, sealed.subarray(0, 10)),
      "invalid_ciphertext"
    )
  })

  it("fails to unwrap the DEK with a different KEK", async () => {
    const dekStore = new InMemoryDekStore()
    const writer = createFieldCrypto({
      keyProvider: new LocalKeyProvider(randomBytes(32)),
      dekStore,
    })
    const sealed = await writer.encryptField(USER_A, "segredo")
    const reader = createFieldCrypto({
      keyProvider: new LocalKeyProvider(randomBytes(32)),
      dekStore,
    })
    await expectCode(reader.decryptField(USER_A, sealed), "decrypt_failed")
  })
})

describe("destroyUserKey", () => {
  it("makes previous ciphertexts unrecoverable (crypto-shredding)", async () => {
    const { crypto, dekStore } = setup()
    const sealed = await crypto.encryptField(USER_A, "segredo")
    await crypto.encryptField(USER_B, "outro")

    await crypto.destroyUserKey(USER_A)

    expect(await dekStore.get(USER_A)).toBeUndefined()
    await expectCode(crypto.decryptField(USER_A, sealed), "key_not_found")

    await crypto.encryptField(USER_A, "novo")
    await expectCode(crypto.decryptField(USER_A, sealed), "decrypt_failed")
    expect(await dekStore.get(USER_B)).toBeDefined()
  })
})

describe("DEK cache", () => {
  it("reuses the unwrapped DEK within the TTL and unwraps again after it", async () => {
    vi.useFakeTimers()
    const provider = new LocalKeyProvider(randomBytes(32))
    const unwrap = vi.spyOn(provider, "unwrapDek")
    const { crypto } = setup({ provider, cacheTtlMs: 1_000 })

    const sealed = await crypto.encryptField(USER_A, "segredo")
    expect(unwrap).toHaveBeenCalledTimes(1)

    await crypto.decryptField(USER_A, sealed)
    vi.advanceTimersByTime(999)
    await crypto.decryptField(USER_A, sealed)
    expect(unwrap).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(1)
    await crypto.decryptField(USER_A, sealed)
    expect(unwrap).toHaveBeenCalledTimes(2)
  })

  it("does not cache when the TTL is zero", async () => {
    const provider = new LocalKeyProvider(randomBytes(32))
    const unwrap = vi.spyOn(provider, "unwrapDek")
    const { crypto } = setup({ provider, cacheTtlMs: 0 })
    const sealed = await crypto.encryptField(USER_A, "segredo")
    await crypto.decryptField(USER_A, sealed)
    await crypto.decryptField(USER_A, sealed)
    expect(unwrap).toHaveBeenCalledTimes(3)
  })

  it("clearCache forces a new unwrap", async () => {
    const provider = new LocalKeyProvider(randomBytes(32))
    const unwrap = vi.spyOn(provider, "unwrapDek")
    const { crypto } = setup({ provider })
    const sealed = await crypto.encryptField(USER_A, "segredo")
    crypto.clearCache()
    await crypto.decryptField(USER_A, sealed)
    expect(unwrap).toHaveBeenCalledTimes(2)
  })
})

describe("LocalKeyProvider", () => {
  it("accepts a 32-byte base64 KEK", () => {
    const provider = LocalKeyProvider.fromBase64(
      LocalKeyProvider.generateKekBase64()
    )
    expect(provider.keyId).toMatch(/^local:[0-9a-f]{16}$/)
  })

  it("derives a stable keyId from the KEK", () => {
    const kek = randomBytes(32)
    expect(new LocalKeyProvider(kek).keyId).toBe(
      new LocalKeyProvider(kek).keyId
    )
  })

  it.each([
    ["too short", randomBytes(16).toString("base64")],
    ["too long", randomBytes(33).toString("base64")],
    ["not base64", "isto não é base64!!"],
    ["empty", ""],
  ])("rejects a KEK that is %s", (_label, value) => {
    expect(() => LocalKeyProvider.fromBase64(value)).toThrow(CryptoError)
  })

  it("reads KEK_LOCAL from the given env", () => {
    const kek = LocalKeyProvider.generateKekBase64()
    expect(LocalKeyProvider.fromEnv({ KEK_LOCAL: kek })).toBeInstanceOf(
      LocalKeyProvider
    )
    expect(() => LocalKeyProvider.fromEnv({})).toThrow(/KEK_LOCAL/)
  })
})

describe("AwsKmsKeyProvider", () => {
  it("throws a clear error when no KMS client is configured", async () => {
    const provider = new AwsKmsKeyProvider({
      keyId: "alias/test",
      region: "sa-east-1",
    })
    await expectCode(
      provider.wrapDek(randomBytes(32), USER_A),
      "provider_not_configured"
    )
    await expectCode(
      provider.unwrapDek(randomBytes(32), USER_A),
      "provider_not_configured"
    )
  })

  it("delegates to an injected client with the user as encryption context", async () => {
    const kek = new LocalKeyProvider(randomBytes(32))
    const client: KmsClient = {
      encrypt: vi.fn(({ plaintext, encryptionContext }) =>
        kek.wrapDek(plaintext, encryptionContext.userId ?? "")
      ),
      decrypt: vi.fn(({ ciphertext, encryptionContext }) =>
        kek.unwrapDek(ciphertext, encryptionContext.userId ?? "")
      ),
    }
    const provider = new AwsKmsKeyProvider({ keyId: "alias/test", client })
    const { crypto } = setup({ provider })
    const sealed = await crypto.encryptField(USER_A, "segredo")
    expect(await crypto.decryptFieldText(USER_A, sealed)).toBe("segredo")
    expect(client.encrypt).toHaveBeenCalledWith(
      expect.objectContaining({
        keyId: "alias/test",
        encryptionContext: { userId: USER_A },
      })
    )
  })
})

describe("keyProviderFromEnv", () => {
  it("defaults to the local provider", () => {
    const provider = keyProviderFromEnv({
      KEK_LOCAL: LocalKeyProvider.generateKekBase64(),
    })
    expect(provider).toBeInstanceOf(LocalKeyProvider)
  })

  it("builds the AWS provider when requested", () => {
    const provider = keyProviderFromEnv({
      KEY_PROVIDER: "aws",
      AWS_KMS_KEY_ID: "alias/test",
      AWS_REGION: "sa-east-1",
    })
    expect(provider).toBeInstanceOf(AwsKmsKeyProvider)
    expect(provider.keyId).toBe("alias/test")
  })

  it("rejects unknown providers and missing AWS key ids", () => {
    expect(() => keyProviderFromEnv({ KEY_PROVIDER: "gcp" })).toThrow(
      CryptoError
    )
    expect(() => keyProviderFromEnv({ KEY_PROVIDER: "aws" })).toThrow(
      /AWS_KMS_KEY_ID/
    )
  })
})
