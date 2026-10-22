import { NextResponse } from "next/server"

import { apiError } from "@/lib/http"
import { getProfileSummary } from "@/lib/profile/summary"
import { getUserContext } from "@/lib/server/context"

/**
 * GET /api/profile (spec 8.5): profile summary without sensitive data. Edits go through the
 * profile server actions (same Zod schemas, RLS session and audit).
 */
export async function GET() {
  const context = await getUserContext()
  if (!context.ok) return apiError("unauthorized", context.error.message, 401)
  try {
    return NextResponse.json(await getProfileSummary(context.ctx), {
      headers: { "cache-control": "no-store" },
    })
  } catch (error) {
    console.error(
      "[profile:get]",
      error instanceof Error ? error.message : error
    )
    return apiError("internal_error", "Could not load the profile.", 500)
  }
}
