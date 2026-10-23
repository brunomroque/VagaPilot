import { NextResponse, type NextRequest } from "next/server"

import { apiError } from "@/lib/http"
import { createPairingCode } from "@/lib/ext/pairing"
import { getUserContext } from "@/lib/server/context"

/** Authenticated user creates an 8-character pairing code (spec §11.3, 10 min). */
export async function POST(_request: NextRequest) {
  const session = await getUserContext()
  if (!session.ok) return apiError("unauthorized", session.error.message, 401)
  try {
    const result = await createPairingCode(session.ctx)
    return NextResponse.json(result)
  } catch (error) {
    console.error(
      "[ext:pair:init]",
      error instanceof Error ? error.message : error
    )
    return apiError("internal_error", "Could not create pairing code.", 500)
  }
}
