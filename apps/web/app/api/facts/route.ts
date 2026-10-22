import { FACT_STATUSES } from "@vagapilot/core/facts"
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"

import {
  confirmFacts,
  editAndConfirmFact,
  editFactSchema,
  factIdsSchema,
  loadFactReview,
  rejectFacts,
} from "@/lib/facts/server"
import { apiError } from "@/lib/http"
import { getUserContext } from "@/lib/server/context"

/** GET /api/facts?status=proposto|confirmado|rejeitado (spec 8.5). */
export async function GET(request: NextRequest) {
  const status = z
    .enum(FACT_STATUSES)
    .safeParse(request.nextUrl.searchParams.get("status") ?? "proposto")
  if (!status.success)
    return apiError("invalid_request", "Invalid status.", 400)
  const context = await getUserContext()
  if (!context.ok) return apiError("unauthorized", context.error.message, 401)
  try {
    return NextResponse.json(await loadFactReview(context.ctx, status.data))
  } catch (error) {
    console.error("[facts:get]", error instanceof Error ? error.message : error)
    return apiError("internal_error", "Could not load facts.", 500)
  }
}

const patchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("confirm"), ids: factIdsSchema }),
  z.object({ action: z.literal("reject"), ids: factIdsSchema }),
  z.object({ action: z.literal("edit"), fact: editFactSchema }),
])

/** PATCH /api/facts: confirm, reject (batch) or edit-and-confirm one fact. Each change is audited. */
export async function PATCH(request: NextRequest) {
  const body: unknown = await request.json().catch(() => null)
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success)
    return apiError("invalid_request", "Invalid fact update.", 400)
  const context = await getUserContext()
  if (!context.ok) return apiError("unauthorized", context.error.message, 401)
  try {
    const input = parsed.data
    switch (input.action) {
      case "confirm":
        return NextResponse.json({
          count: await confirmFacts(context.ctx, input.ids),
        })
      case "reject":
        return NextResponse.json({
          count: await rejectFacts(context.ctx, input.ids),
        })
      case "edit": {
        const updated = await editAndConfirmFact(context.ctx, input.fact)
        return updated
          ? NextResponse.json({ count: 1 })
          : apiError("not_found", "Fact not found.", 404)
      }
      default: {
        const unreachable: never = input
        throw new Error(`Unhandled fact action: ${JSON.stringify(unreachable)}`)
      }
    }
  } catch (error) {
    console.error(
      "[facts:patch]",
      error instanceof Error ? error.message : error
    )
    return apiError("internal_error", "Could not update facts.", 500)
  }
}
