import "server-only"

import {
  createFieldCrypto,
  keyProviderFromEnv,
  type FieldCrypto,
} from "@vagapilot/core/crypto"
import { fromBytea, SupabaseDekStore, toBytea } from "@vagapilot/db/server"

import { getAdminClient } from "./admin"

let fieldCrypto: FieldCrypto | undefined

/** Envelope encryption for `_enc` columns (12.3). DEKs live in `user_keys` (service_role). */
export function getFieldCrypto(): FieldCrypto {
  if (fieldCrypto) return fieldCrypto
  const admin = getAdminClient()
  if (!admin) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured")
  fieldCrypto = createFieldCrypto({
    keyProvider: keyProviderFromEnv(),
    dekStore: new SupabaseDekStore(admin),
  })
  return fieldCrypto
}

/** Encrypts a value (or JSON) to the PostgREST bytea text form. Empty input clears the column. */
export async function sealForColumn(
  userId: string,
  value: string | Record<string, unknown> | null | undefined
): Promise<string | null> {
  if (value === null || value === undefined) return null
  const plaintext = typeof value === "string" ? value : JSON.stringify(value)
  if (!plaintext.trim()) return null
  return toBytea(await getFieldCrypto().encryptField(userId, plaintext))
}

export async function openColumnText(
  userId: string,
  column: string | null | undefined
): Promise<string | null> {
  const bytes = fromBytea(column)
  if (!bytes) return null
  return getFieldCrypto().decryptFieldText(userId, bytes)
}

export async function openColumnJson<T>(
  userId: string,
  column: string | null | undefined
): Promise<T | null> {
  const text = await openColumnText(userId, column)
  return text ? (JSON.parse(text) as T) : null
}
