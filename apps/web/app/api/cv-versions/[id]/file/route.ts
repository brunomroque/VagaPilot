import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"

import { signedCvDownload } from "@/lib/cvs/server"
import { apiError } from "@/lib/http"
import { getUserContext } from "@/lib/server/context"

/**
 * GET /api/cv-versions/:id/file (spec 8.5): redirects to a 5-minute signed URL whose
 * Content-Disposition carries the neutral filename (CA3.1). `?format=json` returns it instead.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!z.uuid().safeParse(id).success) {
    return apiError("invalid_request", "Invalid CV id.", 400)
  }
  const context = await getUserContext()
  if (!context.ok) return apiError("unauthorized", context.error.message, 401)

  try {
    const download = await signedCvDownload(context.ctx, id)
    if (!download) return apiError("not_found", "CV not found.", 404)
    if (request.nextUrl.searchParams.get("format") === "json") {
      return NextResponse.json(download, {
        headers: { "cache-control": "no-store" },
      })
    }
    return NextResponse.redirect(download.url, {
      status: 302,
      headers: { "cache-control": "no-store" },
    })
  } catch (error) {
    console.error(
      "[cv-versions:file]",
      error instanceof Error ? error.message : error
    )
    return apiError("internal_error", "Could not sign the download.", 500)
  }
}
