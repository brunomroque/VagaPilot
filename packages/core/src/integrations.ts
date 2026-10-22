/**
 * Integration activation gate. F16 (risk notice + explicit, versioned acceptance per integration)
 * is implemented in P6; until then `riskAcceptanceRequired` is false and activation is allowed.
 * Every integration switch (Gmail connect today) must go through this check, so P6 only has to
 * provide the acceptance state. Pure: no I/O.
 */

/** F16: explicit, versioned risk acceptance per integration before activation. */
export const RISK_NOTICE_VERSION = "v1"

export const INTEGRATIONS = ["gmail", "extension", "linkedin"] as const

export type Integration = (typeof INTEGRATIONS)[number]

export function riskConsentPurpose(integration: Integration): string {
  switch (integration) {
    case "gmail":
      return "risk_gmail"
    case "extension":
      return "risk_extension"
    case "linkedin":
      return "risk_linkedin"
    default: {
      const unreachable: never = integration
      throw new Error(`Unknown integration: ${String(unreachable)}`)
    }
  }
}

export type RiskLevel = "baixo" | "medio" | "alto"

/** RF16.2 badge. Gmail reads personal e-mail with a restricted scope. */
export function integrationRiskLevel(integration: Integration): RiskLevel {
  switch (integration) {
    case "gmail":
      return "medio"
    case "extension":
      return "medio"
    case "linkedin":
      return "alto"
    default: {
      const unreachable: never = integration
      throw new Error(`Unknown integration: ${String(unreachable)}`)
    }
  }
}

export type ActivationState = {
  /** P6 turns this on once the F16 notice exists for the integration. */
  riskAcceptanceRequired: boolean
  /** Latest acceptance of the current notice version (RF16.4–RF16.6). */
  riskAccepted: boolean
}

export type ActivationCheck =
  { ok: true } | { ok: false; reason: "risk_acceptance_required" }

export function checkIntegrationActivation(
  state: ActivationState
): ActivationCheck {
  if (state.riskAcceptanceRequired && !state.riskAccepted) {
    return { ok: false, reason: "risk_acceptance_required" }
  }
  return { ok: true }
}
