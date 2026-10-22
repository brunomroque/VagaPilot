import { CV_LANGUAGES } from "@vagapilot/core/cv-filename"
import { MAX_CV_BYTES } from "@vagapilot/jobs"
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"

import { uploadCv, type UploadErrorCode } from "@/lib/cvs/server"
import { apiError } from "@/lib/http"
import { getUserContext } from "@/lib/server/context"

const metaSchema = z.object({
  trackId: z.uuid().nullable(),
  language: z.enum(CV_LANGUAGES),
  label: z.string().trim().max(80).nullable(),
})

const UPLOAD_STATUS: Record<UploadErrorCode, number> = {
  file_too_large: 413,
  file_empty: 400,
  unsupported_type: 415,
  too_many_pages: 422,
  no_text: 422,
  unreadable: 422,
  invalid_track: 400,
}

/** POST /api/cv-versions (spec 8.5): multipart upload of one PDF/DOCX CV (P1.2). */
export async function POST(request: NextRequest) {
  const context = await getUserContext()
  if (!context.ok) {
    return apiError(
      context.error.code === "not_configured"
        ? "not_configured"
        : "unauthorized",
      context.error.message,
      context.error.code === "not_configured" ? 503 : 401
    )
  }

  const declared = Number(request.headers.get("content-length") ?? 0)
  if (declared > MAX_CV_BYTES + 64 * 1024) {
    return apiError("file_too_large", "File is larger than 10 MB.", 413)
  }

  const form = await request.formData().catch(() => null)
  const file = form?.get("file")
  if (!(file instanceof File)) {
    return apiError("invalid_request", "Send the CV in the 'file' field.", 400)
  }
  const meta = metaSchema.safeParse({
    trackId: form?.get("trackId") || null,
    language: form?.get("language") || "pt-BR",
    label: form?.get("label") || null,
  })
  if (!meta.success)
    return apiError("invalid_request", "Invalid CV metadata.", 400)

  try {
    const result = await uploadCv(context.ctx, { file, ...meta.data })
    if (!result.ok) {
      return apiError(
        result.error.code,
        result.error.message,
        UPLOAD_STATUS[result.error.code]
      )
    }
    return NextResponse.json(result.data, { status: 201 })
  } catch (error) {
    console.error(
      "[cv-versions:upload]",
      error instanceof Error ? error.message : error
    )
    return apiError("internal_error", "Could not store the CV.", 500)
  }
}
