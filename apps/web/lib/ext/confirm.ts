import "server-only"

import { checkTransition, type ApplicationStatus } from "@vagapilot/core/status"

import { getAdminClient } from "@/lib/server/admin"
import { audit } from "@/lib/server/audit"

export async function confirmApplicationSubmitted(input: {
  userId: string
  applicationId: string
  protocolText: string | null
  pageUrl: string
  confirmedByUser: boolean
}): Promise<{ ok: true } | { ok: false; code: string }> {
  const admin = getAdminClient()
  if (!admin) return { ok: false, code: "not_configured" }
  const { data, error } = await admin
    .from("applications")
    .select("id, status")
    .eq("id", input.applicationId)
    .eq("user_id", input.userId)
    .maybeSingle()
  if (error || !data) return { ok: false, code: "not_found" }
  const current = data as { id: string; status: string }
  if (current.status === "enviada") return { ok: true }

  const check = checkTransition(
    current.status as ApplicationStatus,
    "enviada",
    {
      source: input.confirmedByUser ? "usuario" : "extensao",
      confirmedByUser: input.confirmedByUser,
      hasEvidence: true,
      confidence: input.confirmedByUser ? null : 0.95,
    }
  )
  if (!check.ok) return { ok: false, code: check.reason }

  const evidence = await admin
    .from("evidences")
    .insert({
      user_id: input.userId,
      application_id: input.applicationId,
      kind: "protocol_text",
      text_excerpt: (
        input.protocolText ?? "Candidatura marcada como enviada."
      ).slice(0, 2000),
      url: input.pageUrl.slice(0, 2000),
    })
    .select("id")
    .single()
  if (evidence.error || !evidence.data)
    return { ok: false, code: "evidence_failed" }

  const source = input.confirmedByUser ? "usuario" : "extensao"
  const updated = await admin
    .from("applications")
    .update({
      status: "enviada",
      applied_at: new Date().toISOString(),
    })
    .eq("id", input.applicationId)
    .eq("user_id", input.userId)
    .eq("status", current.status)
  if (updated.error) return { ok: false, code: "status_failed" }

  const event = await admin.from("application_events").insert({
    user_id: input.userId,
    application_id: input.applicationId,
    type: "status_change",
    from_status: current.status,
    to_status: "enviada",
    source,
    confidence: input.confirmedByUser ? null : 0.95,
    payload: {
      via: "extension",
      protocol: input.protocolText,
      url: input.pageUrl,
    },
    evidence_id: (evidence.data as { id: string }).id,
  })
  if (event.error) return { ok: false, code: "status_failed" }

  await audit({
    userId: input.userId,
    actor: input.confirmedByUser ? "usuario" : "extensao",
    action: "application.submitted",
    targetType: "application",
    targetId: input.applicationId,
    details: { protocol: input.protocolText, url: input.pageUrl },
  })
  return { ok: true }
}
