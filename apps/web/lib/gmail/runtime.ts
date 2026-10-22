import "server-only"

import {
  createGmailRuntime,
  gmailMode,
  type GmailMode,
  type GmailRuntime,
} from "@vagapilot/gmail"

import { startIngestionFromJobAlert } from "@/lib/chat/jobs-server"
import { getAdminClient } from "@/lib/server/admin"
import { getFieldCrypto } from "@/lib/server/field-crypto"

let runtime: GmailRuntime | null | undefined

/**
 * Gmail runtime of the web app (service_role + envelope encryption). Background-style writes
 * always carry the signed-in user's id; user-facing reads stay on the RLS session.
 */
export function getGmailRuntime(): GmailRuntime | null {
  if (runtime !== undefined) return runtime
  const admin = getAdminClient()
  runtime = admin
    ? createGmailRuntime({
        admin,
        fieldCrypto: getFieldCrypto(),
        onJobAlert: (batch) =>
          startIngestionFromJobAlert({
            userId: batch.userId,
            urls: batch.urls,
            emailThreadId: batch.emailThreadId,
          }),
      })
    : null
  return runtime
}

/** What the settings card can offer in this environment. */
export function getGmailMode(): GmailMode {
  return gmailMode()
}
