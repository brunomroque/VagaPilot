import "server-only"

import {
  generateDeviceToken,
  generatePairingCode,
  hashDeviceToken,
  isPairingCode,
  nextAttemptWindow,
  normalizePairingCode,
  PAIRING_IP_MAX_ATTEMPTS,
  PAIRING_IP_WINDOW_MS,
  PAIRING_MAX_FAILURES,
  PAIRING_TTL_MS,
} from "@vagapilot/core/ext-auth"
import { isUniqueViolation } from "@vagapilot/core/postgres"

import { getAdminClient } from "@/lib/server/admin"
import type { UserContext } from "@/lib/server/context"

const INSERT_ATTEMPTS = 5

export type PairingOutcome =
  | { status: "paired"; token: string; deviceId: string }
  | { status: "invalid" }
  | { status: "rate_limited" }

type AttemptRow = { attempts: number; window_started_at: string }

function clientIpFromHeaders(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim()
  const ip = forwarded || headers.get("x-real-ip")?.trim() || "unknown"
  return ip.slice(0, 64)
}

export async function createPairingCode(
  ctx: UserContext
): Promise<{ code: string; expiresAt: string }> {
  const admin = getAdminClient()
  if (!admin) throw new Error("not_configured")
  await admin.from("device_pairing_codes").delete().eq("user_id", ctx.user.id)
  const expiresAt = new Date(Date.now() + PAIRING_TTL_MS).toISOString()
  for (let attempt = 0; attempt < INSERT_ATTEMPTS; attempt++) {
    const code = generatePairingCode()
    const { error } = await admin.from("device_pairing_codes").insert({
      code,
      user_id: ctx.user.id,
      expires_at: expiresAt,
      failed_attempts: 0,
    })
    if (!error) return { code, expiresAt }
    if (!isUniqueViolation(error)) throw new Error(error.message)
  }
  throw new Error("pairing_code_collision")
}

async function consumeIpAttempt(ip: string, nowMs: number): Promise<boolean> {
  const admin = getAdminClient()
  if (!admin) return true
  const { data } = await admin
    .from("pairing_ip_attempts")
    .select("attempts, window_started_at")
    .eq("ip", ip)
    .maybeSingle()
  const row = data as AttemptRow | null
  const next = nextAttemptWindow({
    attempts: row?.attempts ?? 0,
    windowStartedAtMs: row ? new Date(row.window_started_at).getTime() : nowMs,
    nowMs,
    windowMs: PAIRING_IP_WINDOW_MS,
    max: PAIRING_IP_MAX_ATTEMPTS + 1,
  })
  await admin.from("pairing_ip_attempts").upsert({
    ip,
    attempts: next.attempts,
    window_started_at: new Date(next.windowStartedAtMs).toISOString(),
  })
  return next.limited
}

/** Counts a miss for this exact string and deletes a live row after 5 misses. */
async function registerCodeFailure(code: string, nowMs: number): Promise<void> {
  const admin = getAdminClient()
  if (!admin) return
  const { data } = await admin
    .from("pairing_code_attempts")
    .select("attempts, window_started_at")
    .eq("code", code)
    .maybeSingle()
  const row = data as AttemptRow | null
  const next = nextAttemptWindow({
    attempts: row?.attempts ?? 0,
    windowStartedAtMs: row ? new Date(row.window_started_at).getTime() : nowMs,
    nowMs,
    windowMs: PAIRING_TTL_MS,
    max: PAIRING_MAX_FAILURES,
  })
  await admin.from("pairing_code_attempts").upsert({
    code,
    attempts: next.attempts,
    window_started_at: new Date(next.windowStartedAtMs).toISOString(),
  })
  await admin
    .from("device_pairing_codes")
    .update({ failed_attempts: next.attempts })
    .eq("code", code)
  if (next.limited) {
    await admin.from("device_pairing_codes").delete().eq("code", code)
  }
}

export async function completePairing(input: {
  code: string
  deviceName: string
  headers: Headers
}): Promise<PairingOutcome> {
  const admin = getAdminClient()
  if (!admin) return { status: "invalid" }
  const nowMs = Date.now()
  const ip = clientIpFromHeaders(input.headers)
  if (await consumeIpAttempt(ip, nowMs)) return { status: "rate_limited" }

  const code = normalizePairingCode(input.code)
  if (!isPairingCode(code)) {
    await registerCodeFailure(code || "invalid", nowMs)
    return { status: "invalid" }
  }

  const { data, error } = await admin
    .from("device_pairing_codes")
    .select("user_id, expires_at, failed_attempts")
    .eq("code", code)
    .maybeSingle()
  if (error || !data) {
    await registerCodeFailure(code, nowMs)
    return { status: "invalid" }
  }
  const row = data as {
    user_id: string
    expires_at: string
    failed_attempts: number
  }
  if (
    row.failed_attempts >= PAIRING_MAX_FAILURES ||
    new Date(row.expires_at).getTime() < nowMs
  ) {
    await registerCodeFailure(code, nowMs)
    await admin.from("device_pairing_codes").delete().eq("code", code)
    return { status: "invalid" }
  }

  const token = generateDeviceToken()
  const inserted = await admin
    .from("devices")
    .insert({
      user_id: row.user_id,
      name: input.deviceName.slice(0, 120) || "Chrome",
      token_hash: hashDeviceToken(token),
      last_seen_at: new Date(nowMs).toISOString(),
    })
    .select("id")
    .single()
  if (inserted.error || !inserted.data) {
    await registerCodeFailure(code, nowMs)
    return { status: "invalid" }
  }
  await admin.from("device_pairing_codes").delete().eq("code", code)
  await admin.from("pairing_code_attempts").delete().eq("code", code)
  return {
    status: "paired",
    token,
    deviceId: (inserted.data as { id: string }).id,
  }
}
