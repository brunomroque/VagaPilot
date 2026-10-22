import type { ConsentPurpose } from "@vagapilot/core/consents"

/** Restricted Gmail scopes, requested incrementally and separately (RF11.1, 11.2). */
export const GMAIL_READONLY_SCOPE =
  "https://www.googleapis.com/auth/gmail.readonly"
export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send"

/** "leitura": track statuses (gmail.readonly). "envio": apply by e-mail (gmail.send, P6). */
export const GMAIL_SCOPE_KINDS = ["leitura", "envio"] as const

export type GmailScopeKind = (typeof GMAIL_SCOPE_KINDS)[number]

export function isGmailScopeKind(value: unknown): value is GmailScopeKind {
  return (
    typeof value === "string" &&
    (GMAIL_SCOPE_KINDS as readonly string[]).includes(value)
  )
}

export function scopeForKind(kind: GmailScopeKind): string {
  switch (kind) {
    case "leitura":
      return GMAIL_READONLY_SCOPE
    case "envio":
      return GMAIL_SEND_SCOPE
    default: {
      const unreachable: never = kind
      throw new Error(`Unknown Gmail scope kind: ${String(unreachable)}`)
    }
  }
}

export function consentPurposeForKind(kind: GmailScopeKind): ConsentPurpose {
  switch (kind) {
    case "leitura":
      return "gmail_leitura"
    case "envio":
      return "gmail_envio"
    default: {
      const unreachable: never = kind
      throw new Error(`Unknown Gmail scope kind: ${String(unreachable)}`)
    }
  }
}

export function hasScope(
  scopes: readonly string[] | null | undefined,
  kind: GmailScopeKind
) {
  return (scopes ?? []).includes(scopeForKind(kind))
}
