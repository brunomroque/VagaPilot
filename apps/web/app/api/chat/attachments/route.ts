import {
  detectStoredAttachmentKind,
  resolveDocumentRole,
  type StoredAttachmentKind,
} from "@vagapilot/core/chat-attachments"
import { MAX_CV_BYTES } from "@vagapilot/jobs"
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"

import { MAX_JOB_IMAGE_BYTES } from "@/lib/chat/attachment-files"
import { storeChatAttachment } from "@/lib/chat/attachments-store"
import { apiError, type ApiErrorCode } from "@/lib/http"
import { getUserContext } from "@/lib/server/context"

const metaSchema = z.object({
  conversationId: z.uuid(),
  role: z.enum(["auto", "cv", "job_document", "job_image"]).default("auto"),
  messageHint: z.string().max(500).optional(),
})

const ERROR_STATUS: Record<string, number> = {
  file_too_large: 413,
  unsupported_type: 415,
  unreadable: 422,
  no_text: 422,
  too_many_pages: 422,
  invalid_track: 400,
  storage_failed: 500,
  write_failed: 500,
}

/** POST /api/chat/attachments — secure upload for chat composer (PDF/DOCX/TXT/images). */
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
  if (declared > MAX_CV_BYTES + 256 * 1024) {
    return apiError("file_too_large", "File is too large.", 413)
  }

  const form = await request.formData().catch(() => null)
  const file = form?.get("file")
  if (!(file instanceof File)) {
    return apiError(
      "invalid_request",
      "Send the file in the 'file' field.",
      400
    )
  }

  const meta = metaSchema.safeParse({
    conversationId: form?.get("conversationId"),
    role: form?.get("role") ?? "auto",
    messageHint: form?.get("messageHint") ?? undefined,
  })
  if (!meta.success) {
    return apiError("invalid_request", "Invalid attachment metadata.", 400)
  }

  let kind: StoredAttachmentKind | "unsupported" = "unsupported"
  const detected = detectStoredAttachmentKind(file.name, meta.data.role)
  if (detected === "ambiguous_document") {
    kind = resolveDocumentRole(meta.data.messageHint ?? "")
  } else if (detected === "unsupported") {
    return apiError(
      "unsupported_type",
      "Tipo de arquivo não suportado no chat.",
      415
    )
  } else {
    kind = detected
  }

  if (kind === "job_image" && file.size > MAX_JOB_IMAGE_BYTES) {
    return apiError("file_too_large", "Image is larger than 5 MB.", 413)
  }
  if (kind !== "job_image" && file.size > MAX_CV_BYTES) {
    return apiError("file_too_large", "File is larger than 10 MB.", 413)
  }

  try {
    const stored = await storeChatAttachment(context.ctx, {
      conversationId: meta.data.conversationId,
      file,
      kind,
      messageHint: meta.data.messageHint,
    })
    if (!stored.ok) {
      const apiCode: ApiErrorCode =
        stored.code === "file_too_large" ||
        stored.code === "unsupported_type" ||
        stored.code === "unreadable" ||
        stored.code === "no_text" ||
        stored.code === "too_many_pages" ||
        stored.code === "invalid_track" ||
        stored.code === "file_empty"
          ? stored.code
          : "invalid_request"
      return apiError(apiCode, stored.message, ERROR_STATUS[stored.code] ?? 400)
    }
    return NextResponse.json(
      {
        id: stored.attachment.id,
        kind: stored.attachment.kind,
        fileName: stored.attachment.file_name,
        mimeType: stored.attachment.mime_type,
        cvVersionId: stored.cvVersionId ?? null,
        status: stored.processing ?? "pronto",
        proposedFacts: stored.proposedFacts ?? 0,
        extractionError: stored.extractionError ?? null,
      },
      { status: 201 }
    )
  } catch (error) {
    console.error(
      "[chat/attachments]",
      error instanceof Error ? error.message : error
    )
    return apiError("internal_error", "Could not store the attachment.", 500)
  }
}
