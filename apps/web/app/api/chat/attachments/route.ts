import { getTranslations } from "next-intl/server"
import { z } from "zod"

import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_MESSAGE,
} from "@vagapilot/core/chat-attachments"

import { ensureConversation } from "@/lib/chat/conversations"
import { uploadChatAttachment } from "@/lib/chat/attachments-server"
import { apiError } from "@/lib/http"
import { getUserContext } from "@/lib/server/context"
import { checkUpstashRateLimit } from "@/lib/server/upstash-ratelimit"

/** POST /api/chat/attachments: multipart `files` (≤4, ≤4 MB each) + `conversationId`. */
export const maxDuration = 60

export async function POST(request: Request) {
  const t = await getTranslations("Chat.attachments.errors")
  const context = await getUserContext()
  if (!context.ok) return apiError("unauthorized", t("unauthorized"), 401)
  const ctx = context.ctx

  const length = Number(request.headers.get("content-length") ?? "0")
  if (length > MAX_ATTACHMENTS_PER_MESSAGE * MAX_ATTACHMENT_BYTES + 64_000) {
    return apiError("file_too_large", t("tooLarge"), 413)
  }
  const limited = await checkUpstashRateLimit(
    `chat-attach:${ctx.user.id}`,
    10,
    "1 m"
  )
  if (limited.limited) return apiError("rate_limited", t("rateLimited"), 429)

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return apiError("invalid_request", t("invalid"), 400)
  }
  const conversationId = z.uuid().safeParse(form.get("conversationId"))
  const files = form.getAll("files").filter((f): f is File => f instanceof File)
  if (!conversationId.success || files.length === 0) {
    return apiError("invalid_request", t("invalid"), 400)
  }
  if (files.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    return apiError(
      "too_many_files",
      t("tooMany", { max: MAX_ATTACHMENTS_PER_MESSAGE }),
      400
    )
  }
  try {
    await ensureConversation(ctx, conversationId.data)
  } catch {
    return apiError("not_found", t("invalid"), 404)
  }

  const results = []
  for (const file of files) {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      return apiError("file_too_large", t("tooLarge"), 413)
    }
    const outcome = await uploadChatAttachment(ctx, file, conversationId.data)
    if (!outcome.ok) {
      const key =
        outcome.code === "file_too_large"
          ? "tooLarge"
          : outcome.code === "unsupported_type"
            ? "unsupported"
            : "invalid"
      return apiError(
        outcome.code,
        `${file.name}: ${t(key)}`,
        outcome.code === "file_too_large" ? 413 : 415
      )
    }
    const a = outcome.attachment
    results.push({
      id: a.id,
      path: a.path,
      name: a.name,
      kind: a.kind,
      type: a.type,
      extractionError: a.extractionError,
      preview: a.image?.title
        ? [a.image.title, a.image.company].filter(Boolean).join(" · ")
        : null,
    })
  }
  return Response.json({ attachments: results })
}
