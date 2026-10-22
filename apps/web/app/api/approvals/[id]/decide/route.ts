import { z } from "zod"

import { decideApproval } from "@/lib/approvals/decide"
import { NextResponse } from "next/server"

import { apiError } from "@/lib/http"
import { getUserContext } from "@/lib/server/context"

const bodySchema = z.object({
  approve: z.boolean(),
  via: z.enum(["web", "extensao", "email"]).optional(),
})

/** POST /api/approvals/:id/decide (spec 8.5, P6 — generic approvals incl. criar_fato / enviar_email). */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const session = await getUserContext()
  if (!session.ok) {
    return session.error.code === "unauthorized"
      ? apiError("unauthorized", "Sign in first.", 401)
      : apiError("not_configured", "Supabase is not configured.", 503)
  }

  const { id } = await context.params
  const parsedId = z.uuid().safeParse(id)
  if (!parsedId.success)
    return apiError("invalid_request", "Invalid approval id.", 400)

  const body = bodySchema.safeParse(await request.json().catch(() => null))
  if (!body.success) return apiError("invalid_request", "Invalid body.", 400)

  const result = await decideApproval(session.ctx, {
    approvalId: parsedId.data,
    approve: body.data.approve,
    via: body.data.via,
  })
  if (!result.ok) {
    const status =
      result.code === "not_found" ? 404 : result.code === "conflict" ? 409 : 400
    const code =
      result.code === "not_found" || result.code === "conflict"
        ? result.code
        : "invalid_request"
    return apiError(code, result.message, status)
  }
  return NextResponse.json({ status: result.status })
}
