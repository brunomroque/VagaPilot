import { NextResponse, type NextRequest } from "next/server"

import { revokeGmailConnection } from "@vagapilot/gmail"
import {
  gmailRevokedEvent,
  inngest,
  isInngestConfigured,
} from "@vagapilot/jobs"

import { getUserContext } from "@/lib/server/context"
import { hasSameOrigin } from "@/lib/gmail/http"
import { getGmailRuntime } from "@/lib/gmail/runtime"
import { apiError } from "@/lib/http"

/**
 * DELETE /api/google/connection (RF11.9, CA11.3): revokes at Google, deletes the token row and
 * cancels running syncs (Inngest cancelOn + per-message connection check), then withdraws the
 * gmail_leitura / gmail_envio consents. E-mails already linked stay as evidence.
 */
export async function DELETE(request: NextRequest) {
  if (!hasSameOrigin(request))
    return apiError("invalid_request", "Cross-origin request.", 403)
  const session = await getUserContext()
  if (!session.ok) return apiError("unauthorized", "Sign in first.", 401)
  const { user, supabase } = session.ctx
  const runtime = getGmailRuntime()
  if (!runtime)
    return apiError(
      "not_configured",
      "Supabase service role is not configured.",
      503
    )

  const outcome = await revokeGmailConnection(runtime, user.id, {
    actor: "usuario",
    userAgent: request.headers.get("user-agent") ?? undefined,
  })
  if (isInngestConfigured()) {
    await inngest.send(gmailRevokedEvent.create({ userId: user.id }))
  }
  if (outcome.existed) {
    await supabase.from("consents").insert([
      {
        user_id: user.id,
        purpose: "gmail_leitura",
        version: "v1",
        granted: false,
      },
      {
        user_id: user.id,
        purpose: "gmail_envio",
        version: "v1",
        granted: false,
      },
    ])
  }
  return NextResponse.json({
    data: { revoked: outcome.existed, google: outcome.google },
  })
}
