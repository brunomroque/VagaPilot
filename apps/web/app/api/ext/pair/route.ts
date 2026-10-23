import { NextResponse, type NextRequest } from "next/server"
import { getTranslations } from "next-intl/server"
import { z } from "zod"

import { apiError } from "@/lib/http"
import { completePairing } from "@/lib/ext/pairing"

const bodySchema = z.object({
  code: z.string().min(1).max(32),
  deviceName: z.string().min(1).max(120),
})

/** Extension exchanges a pairing code for a device token (spec §11.3). */
export async function POST(request: NextRequest) {
  const t = await getTranslations("Pairing")
  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return apiError("invalid_request", t("invalidPayload"), 400)
  }
  const result = await completePairing({
    code: parsed.data.code,
    deviceName: parsed.data.deviceName,
    headers: request.headers,
  })
  if (result.status === "rate_limited") {
    return apiError("rate_limited", t("rateLimited"), 429)
  }
  if (result.status !== "paired") {
    return apiError("not_found", t("invalid"), 404)
  }
  return NextResponse.json({ token: result.token, deviceId: result.deviceId })
}
