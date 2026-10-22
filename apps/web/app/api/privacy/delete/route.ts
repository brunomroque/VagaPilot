import { requestAccountDeletion } from "@/lib/privacy/delete-account"
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
    return apiError("internal_error", "Could not schedule deletion.", 500)
  }
}
