import type { NextRequest } from "next/server"

import { hashDeviceToken } from "@vagapilot/core/ext-auth"

import { getAdminClient } from "@/lib/server/admin"

export type DeviceAuth =
  | { ok: true; userId: string; deviceId: string }
  | { ok: false; code: "unauthorized" | "revoked" }

export function readDeviceToken(request: NextRequest): string | null {
  const header = request.headers.get("authorization")
  if (header?.startsWith("Bearer "))
    return header.slice("Bearer ".length).trim()
  const alt = request.headers.get("x-vagapilot-device-token")
  return alt?.trim() ?? null
}

/** Validates the extension device token (11.3). Uses service_role; never logs the token. */
export async function authenticateDevice(
  request: NextRequest
): Promise<DeviceAuth> {
  const token = readDeviceToken(request)
  if (!token) return { ok: false, code: "unauthorized" }
  const admin = getAdminClient()
  if (!admin) return { ok: false, code: "unauthorized" }
  const tokenHash = hashDeviceToken(token)
  const { data, error } = await admin
    .from("devices")
    .select("id, user_id, revoked_at")
    .eq("token_hash", tokenHash)
    .maybeSingle()
  if (error || !data) return { ok: false, code: "unauthorized" }
  const row = data as { id: string; user_id: string; revoked_at: string | null }
  if (row.revoked_at) return { ok: false, code: "revoked" }
  await admin
    .from("devices")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", row.id)
  return { ok: true, userId: row.user_id, deviceId: row.id }
}
