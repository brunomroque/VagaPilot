"use server"

import { SALARY_APPLY_OVERRIDE_CHOICE } from "@vagapilot/core/job-rules"

import { fail, ok, type ActionResult } from "@/lib/action-result"
import { getAdminClient } from "@/lib/server/admin"
import { getUserContext } from "@/lib/server/context"

export async function loadSalaryGateQuestionAction(
  applicationId: string
): Promise<ActionResult<{ id: string; options: string[] } | null>> {
  const auth = await getUserContext()
  if (!auth.ok) return { ok: false as const, error: auth.error }
  const admin = getAdminClient()
  if (!admin) return fail("internal_error", "Server not configured.")
  const { data } = await admin
    .from("pending_questions")
    .select("id, options")
    .eq("application_id", applicationId)
    .eq("user_id", auth.ctx.user.id)
    .eq("field_type", "salary_gate")
    .eq("status", "aberta")
    .maybeSingle()
  if (!data) return ok(null)
  const row = data as { id: string; options: unknown }
  const options = Array.isArray(row.options)
    ? row.options.map(String)
    : [SALARY_APPLY_OVERRIDE_CHOICE, "Cancelar"]
  return ok({ id: row.id, options })
}
