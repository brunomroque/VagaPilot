"use server"

import { checkExtensionActivation } from "@/lib/gmail/activation"
import { createPairingCode } from "@/lib/ext/pairing"
import { fail, ok, type ActionResult } from "@/lib/server/context"
import { getUserContext } from "@/lib/server/context"

export async function startExtensionPairing(): Promise<
  ActionResult<{ code: string; expiresAt: string }>
> {
  const session = await getUserContext()
  if (!session.ok) return fail(session.error.code, session.error.message)
  const activation = await checkExtensionActivation(session.ctx.user)
  if (!activation.ok) {
    return fail("conflict", "Accept the integration risk notice first.")
  }
  try {
    const result = await createPairingCode(session.ctx)
    return ok(result)
  } catch {
    return fail("internal_error", "Não foi possível gerar o código.")
  }
}
