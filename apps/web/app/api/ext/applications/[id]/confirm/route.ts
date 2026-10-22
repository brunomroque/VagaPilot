import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"

import { apiError } from "@/lib/http"
import { authenticateDevice } from "@/lib/ext/http"
import { confirmApplicationSubmitted } from "@/lib/ext/confirm"

const bodySchema = z.object({
  protocolText: z.string().max(2000).nullable().optional(),
  pageUrl: z.string().url().max(2000),
  confirmedByUser: z.boolean().default(true),
})

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!z.uuid().safeParse(id).success) {
    return apiError("invalid_request", "Invalid application id.", 400)
  }
  const auth = await authenticateDevice(request)
  if (!auth.ok) return apiError("unauthorized", "Device not authorized.", 401)
  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success)
    return apiError("invalid_request", "Invalid confirmation payload.", 400)

  const result = await confirmApplicationSubmitted({
    userId: auth.userId,
    applicationId: id,
    protocolText: parsed.data.protocolText ?? null,
    pageUrl: parsed.data.pageUrl,
    confirmedByUser: parsed.data.confirmedByUser,
  })
  if (!result.ok) {
    const status = result.code === "not_found" ? 404 : 409
    return apiError("conflict", result.code, status)
  }
  return NextResponse.json({ ok: true })
}
