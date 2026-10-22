"use server"

import { type Integration } from "@vagapilot/core/integrations"

import { recordRiskAcceptance } from "@/lib/risk/server"
import { audit } from "@/lib/server/audit"
import {
  fail,
  ok,
  getUserContext,
  type ActionResult,
} from "@/lib/server/context"

export async function acceptIntegrationRiskAction(
  integration: Integration
): Promise<ActionResult<{ accepted: true }>> {
  const session = await getUserContext()
  if (!session.ok) return fail(session.error.code, session.error.message)
  await recordRiskAcceptance(session.ctx, integration)
  await audit({
    userId: session.ctx.user.id,
    actor: "usuario",
    action: "risk.accepted",
    targetType: "integration",
    details: { integration },
  })
  return ok({ accepted: true })
}
