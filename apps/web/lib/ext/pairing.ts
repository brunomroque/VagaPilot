import "server-only"

import {
  generateDeviceToken,
  generatePairingCode,
  hashDeviceToken,
  PAIRING_TTL_MS,
} from "@vagapilot/core/ext-auth"

import { getAdminClient } from "@/lib/server/admin"
import type { UserContext } from "@/lib/server/context"

export async function createPairingCode(
  ctx: UserContext
): Promise<{ code: string; expiresAt: string }> {
  const admin = getAdminClient()
  if (!admin) throw new Error("not_configured")
  await admin.from("device_pairing_codes").delete().eq("user_id", ctx.user.id)
  const code = generatePairingCode()
  const expiresAt = new Date(Date.now() + PAIRING_TTL_MS).toISOString()
  const { error } = await admin.from("device_pairing_codes").insert({
    code,
    user_id: ctx.user.id,
    expires_at: expiresAt,
  })
  if (error) throw new Error(error.message)
  return { code, expiresAt }
}

export async function completePairing(input: {
  code: string
  deviceName: string
}): Promise<{ token: string; deviceId: string } | null> {
  const admin = getAdminClient()
  if (!admin) return null
  const { data, error } = await admin
    .from("device_pairing_codes")
    .select("user_id, expires_at")
    .eq("code", input.code)
    .maybeSingle()
  if (error || !data) return null
  const row = data as { user_id: string; expires_at: string }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await admin.from("device_pairing_codes").delete().eq("code", input.code)
    return null
  }
  const token = generateDeviceToken()
  const tokenHash = hashDeviceToken(token)
  const inserted = await admin
    .from("devices")
    .insert({
      user_id: row.user_id,
      name: input.deviceName.slice(0, 120) || "Chrome",
      token_hash: tokenHash,
      last_seen_at: new Date().toISOString(),
    })
    .select("id")
    .single()
  if (inserted.error || !inserted.data) return null
  await admin.from("device_pairing_codes").delete().eq("code", input.code)
  return { token, deviceId: (inserted.data as { id: string }).id }
}
