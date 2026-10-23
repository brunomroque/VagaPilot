import {
  cancelAccountDeletion,
  requestAccountDeletion,
} from "@/lib/privacy/delete-account"
import { apiError } from "@/lib/http"
import { getUserContext } from "@/lib/server/context"

/** POST /api/privacy/delete — schedules account purge within 15 days (spec 12, P6.4). */
export async function POST() {
  const session = await getUserContext()
  if (!session.ok) {
    return session.error.code === "unauthorized"
      ? apiError("unauthorized", "Sign in first.", 401)
      : apiError("not_configured", "Supabase is not configured.", 503)
  }

  try {
    const scheduled = await requestAccountDeletion(session.ctx.user.id)
    return Response.json({
      scheduledPurgeAt: scheduled.toISOString(),
    })
  } catch {
    return apiError(
      "internal_error",
      "Não foi possível agendar a exclusão.",
      500
    )
  }
}

/** DELETE /api/privacy/delete — cancels a pending purge (spec §12). */
export async function DELETE() {
  const session = await getUserContext()
  if (!session.ok) {
    return session.error.code === "unauthorized"
      ? apiError("unauthorized", "Entre na conta para continuar.", 401)
      : apiError("not_configured", "O Supabase não está configurado.", 503)
  }
  try {
    const cancelled = await cancelAccountDeletion(session.ctx.user.id)
    if (!cancelled) {
      return apiError(
        "not_found",
        "Não há uma exclusão pendente para cancelar.",
        404
      )
    }
    return Response.json({ cancelled: true })
  } catch {
    return apiError(
      "internal_error",
      "Não foi possível cancelar a exclusão.",
      500
    )
  }
}
