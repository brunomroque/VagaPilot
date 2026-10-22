import "server-only"

import {
  checkIntegrationActivation,
  RISK_NOTICE_VERSION,
  type ActivationCheck,
} from "@vagapilot/core/integrations"

import type { CurrentUser } from "@/lib/auth/session"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { hasRiskAcceptance } from "@/lib/risk/server"
import { getUserContext } from "@/lib/server/context"

/**
 * Gate every Gmail activation (OAuth start). F16: versioned risk notice per integration (P6).
 */
export async function checkGmailActivation(
  user: CurrentUser
): Promise<ActivationCheck> {
  void RISK_NOTICE_VERSION
  const supabase = await createSupabaseServerClient()
  if (!supabase) {
    return checkIntegrationActivation({
      riskAcceptanceRequired: true,
      riskAccepted: false,
    })
  }
  const ctx = { user, supabase }
  const accepted = await hasRiskAcceptance(ctx, "gmail")
  return checkIntegrationActivation({
    riskAcceptanceRequired: true,
    riskAccepted: accepted,
  })
}

export async function checkExtensionActivation(
  user: CurrentUser
): Promise<ActivationCheck> {
  const session = await getUserContext()
  if (!session.ok) {
    return checkIntegrationActivation({
      riskAcceptanceRequired: true,
      riskAccepted: false,
    })
  }
  if (session.ctx.user.id !== user.id) {
    return checkIntegrationActivation({
      riskAcceptanceRequired: true,
      riskAccepted: false,
    })
  }
  const accepted = await hasRiskAcceptance(session.ctx, "extension")
  return checkIntegrationActivation({
    riskAcceptanceRequired: true,
    riskAccepted: accepted,
  })
}
