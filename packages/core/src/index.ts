/**
 * Foundation entry for pure domain code.
 * Status transitions, salary rules and entitlements (P6).
 */
export function isCorePackageReady(): boolean {
  return true
}

export * from "./audit.js"
export * from "./blocklist.js"
export * from "./br-documents.js"
export * from "./consents.js"
export * from "./crypto.js"
export * from "./cv-filename.js"
export * from "./email.js"
export * from "./email-dates.js"
export * from "./email-linking.js"
export * from "./email-outcome.js"
export * from "./facts.js"
export * from "./integrations.js"
export * from "./reminders.js"
export * from "./redact.js"
export * from "./csv.js"
export * from "./dates.js"
export * from "./status.js"
export * from "./tracker.js"
export * from "./tracker-csv.js"
export * from "./job-text.js"
export * from "./job-rules.js"
export * from "./settings.js"
export * from "./policy.js"
export * from "./guardrails.js"
export * from "./entitlements.js"
export * from "./application-email.js"
