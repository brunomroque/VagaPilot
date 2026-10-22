import { buildPrivacyExportBundle } from "@/lib/privacy/export"
import { apiError } from "@/lib/http"
import { audit } from "@/lib/server/audit"
import { getAdminClient } from "@/lib/server/admin"
import { getUserContext } from "@/lib/server/context"

const EXPORT_TTL_SECONDS = 24 * 60 * 60

/** POST /api/privacy/export (spec 8.5, P6.4 LGPD ZIP, link 24 h). */
export async function POST() {
  const session = await getUserContext()
  if (!session.ok) {
    return session.error.code === "unauthorized"
      ? apiError("unauthorized", "Sign in first.", 401)
      : apiError("not_configured", "Supabase is not configured.", 503)
  }

  const admin = getAdminClient()
  if (!admin) return apiError("not_configured", "Admin client missing.", 503)

  const userId = session.ctx.user.id
  const zip = await buildPrivacyExportBundle(session.ctx.supabase, userId)
  const path = `${userId}/${crypto.randomUUID()}.zip`
  const expiresAt = new Date(Date.now() + EXPORT_TTL_SECONDS * 1000)

  const upload = await admin.storage.from("exports").upload(path, zip, {
    contentType: "application/zip",
    upsert: false,
  })
  if (upload.error) {
    return apiError("internal_error", "Could not store the export.", 500)
  }

  await admin.from("privacy_exports").insert({
    user_id: userId,
    storage_path: path,
    status: "ready",
    expires_at: expiresAt.toISOString(),
    completed_at: new Date().toISOString(),
  })

  const signed = await admin.storage
    .from("exports")
    .createSignedUrl(path, EXPORT_TTL_SECONDS)
  if (signed.error || !signed.data?.signedUrl) {
    return apiError("internal_error", "Could not sign the export URL.", 500)
  }

  await audit({
    userId,
    actor: "usuario",
    action: "data.exported",
    targetType: "privacy_export",
    details: { expires_at: expiresAt.toISOString() },
  })

  return Response.json({
    url: signed.data.signedUrl,
    expiresAt: expiresAt.toISOString(),
  })
}
