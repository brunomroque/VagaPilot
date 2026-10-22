import type { SupabaseClient } from "@supabase/supabase-js"
import type { DekStore, WrappedDekRecord } from "@vagapilot/core/crypto"

import { fromBytea, toBytea } from "../bytea.js"

type UserKeyRow = {
  wrapped_dek: string
  key_id: string
  created_at: string
}

/**
 * `DekStore` backed by `public.user_keys`. Needs a service_role client: the table has no
 * client grants. `put` is insert-if-absent and never overwrites an existing key.
 */
export class SupabaseDekStore implements DekStore {
  constructor(private readonly admin: SupabaseClient) {}

  async get(userId: string): Promise<WrappedDekRecord | undefined> {
    const { data, error } = await this.admin
      .from("user_keys")
      .select("wrapped_dek, key_id, created_at")
      .eq("user_id", userId)
      .maybeSingle<UserKeyRow>()
    if (error) throw new Error(`user_keys read failed: ${error.message}`)
    if (!data) return undefined
    const wrappedDek = fromBytea(data.wrapped_dek)
    if (!wrappedDek) return undefined
    return {
      wrappedDek,
      keyId: data.key_id,
      createdAt: new Date(data.created_at),
    }
  }

  async put(
    userId: string,
    record: WrappedDekRecord
  ): Promise<WrappedDekRecord> {
    const { error } = await this.admin.from("user_keys").upsert(
      {
        user_id: userId,
        wrapped_dek: toBytea(record.wrappedDek),
        key_id: record.keyId,
        created_at: record.createdAt.toISOString(),
      },
      { onConflict: "user_id", ignoreDuplicates: true }
    )
    if (error) throw new Error(`user_keys insert failed: ${error.message}`)
    const stored = await this.get(userId)
    if (!stored) throw new Error("user_keys insert did not persist")
    return stored
  }

  async delete(userId: string): Promise<void> {
    const { error } = await this.admin
      .from("user_keys")
      .delete()
      .eq("user_id", userId)
    if (error) throw new Error(`user_keys delete failed: ${error.message}`)
  }
}
