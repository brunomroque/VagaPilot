import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"

import { apiError } from "@/lib/http"
import { completePairing } from "@/lib/ext/pairing"

const bodySchema = z.object({
  code: z.string().regex(/^\d{6}$/),
  deviceName: z.string().min(1).max(120),
})

/** Extension exchanges a pairing code for a device token (11.3). */
export async function POST(request: NextRequest) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success)
    return apiError("invalid_request", "Invalid pairing payload.", 400)
  const result = await completePairing(parsed.data)
  if (!result)
    return apiError("not_found", "Invalid or expired pairing code.", 404)
  return NextResponse.json(result)
}
