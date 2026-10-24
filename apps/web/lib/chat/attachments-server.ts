import "server-only"

import { createHash, randomUUID } from "node:crypto"

import {
  isAiUnavailable,
  readJobImage,
  type JobImageReading,
} from "@vagapilot/ai"
import {
  ATTACHMENT_MIME,
  AttachmentError,
  classifyDocumentText,
  detectAttachmentType,
  isImageType,
  MAX_ATTACHMENT_TEXT_CHARS,
  type AttachmentErrorCode,
  type AttachmentFileType,
  type AttachmentKind,
} from "@vagapilot/core/chat-attachments"
import { CvFileError, extractCvTextOrOcr } from "@vagapilot/jobs"
import { z } from "zod"

import { audit } from "@/lib/server/audit"
import type { UserContext } from "@/lib/server/context"

/** Attachments reuse the private `cvs` bucket (RLS: first folder = auth.uid()). */
export const ATTACHMENT_BUCKET = "cvs"

export type ChatAttachmentRef = {
  id: string
  path: string
  name: string
  kind: AttachmentKind
  type: AttachmentFileType
}

export type ChatAttachment = ChatAttachmentRef & {
  text: string
  truncated: boolean
  image: JobImageReading | null
  extractionError: string | null
}

export const attachmentRefSchema = z.object({
  id: z.uuid(),
  path: z.string().max(300),
  name: z.string().max(200),
  kind: z.enum(["cv", "job_description", "job_image", "document"]),
  type: z.enum(["pdf", "docx", "txt", "png", "jpg", "webp"]),
})

const metaSchema = attachmentRefSchema.extend({
  text: z.string(),
  truncated: z.boolean(),
  image: z
    .object({
      isJobPosting: z.boolean(),
      documentType: z.enum(["job_posting", "cv", "other"]).optional(),
      company: z.string().nullable(),
      title: z.string().nullable(),
      location: z.string().nullable(),
      workModel: z.string().nullable(),
      url: z.string().nullable(),
      text: z.string(),
    })
    .nullable(),
  extractionError: z.string().nullable(),
})

function safeName(name: string): string {
  return name.replace(/[\\/\0<>]/g, "_").slice(0, 120) || "arquivo"
}

export type UploadAttachmentOutcome =
  | { ok: true; attachment: ChatAttachment }
  | { ok: false; code: AttachmentErrorCode | "unreadable"; message: string }

async function extractText(
  bytes: Uint8Array,
  type: AttachmentFileType
): Promise<{ text: string; error: string | null }> {
  if (type === "txt")
    return { text: new TextDecoder().decode(bytes), error: null }
  if (type === "pdf" || type === "docx") {
    try {
      return { text: (await extractCvTextOrOcr(bytes, type)).text, error: null }
    } catch (error) {
      return {
        text: "",
        error: error instanceof CvFileError ? error.code : "unreadable",
      }
    }
  }
  return { text: "", error: null }
}

async function storedCvText(
  ctx: UserContext,
  bytes: Uint8Array
): Promise<string | null> {
  const sha = createHash("sha256").update(bytes).digest("hex")
  const { data } = await ctx.supabase
    .from("cv_versions")
    .select("extracted_text")
    .eq("user_id", ctx.user.id)
    .eq("file_sha256", sha)
    .not("extracted_text", "is", null)
    .limit(1)
    .maybeSingle<{ extracted_text: string | null }>()
  return data?.extracted_text?.trim() ? data.extracted_text : null
}

/** A screenshot of a CV is a CV, not a "print de vaga" (QA: pasted CV image was mislabeled). */
export function imageKind(
  reading: JobImageReading,
  text: string,
  name: string
): AttachmentKind {
  if (reading.documentType === "cv") return "cv"
  if (reading.documentType === "job_posting" || reading.isJobPosting) {
    return "job_image"
  }
  const byText = classifyDocumentText(text, name)
  if (byText === "cv") return "cv"
  return byText === "document" ? "document" : "job_image"
}

/** Validates, stores privately under {uid}/chat/{conversation}/ and parses server-side. */
export async function uploadChatAttachment(
  ctx: UserContext,
  file: File,
  conversationId: string
): Promise<UploadAttachmentOutcome> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let type: AttachmentFileType
  try {
    type = detectAttachmentType(bytes, file.name)
  } catch (error) {
    if (error instanceof AttachmentError) {
      return { ok: false, code: error.code, message: error.message }
    }
    throw error
  }
  const id = randomUUID()
  const name = safeName(file.name)
  const path = `${ctx.user.id}/chat/${conversationId}/${id}.${type}`

  let text = ""
  let extractionError: string | null = null
  let image: JobImageReading | null = null
  let kind: AttachmentKind
  if (isImageType(type)) {
    kind = "job_image"
    if (!isAiUnavailable()) {
      try {
        image = (
          await readJobImage(
            { bytes, mediaType: ATTACHMENT_MIME[type] },
            // QA: a pasted image failed at ~60 s (Netlify limit); fail fast and keep the file.
            { abortSignal: AbortSignal.timeout(25_000) }
          )
        ).reading
        text = image.text
        kind = imageKind(image, text, name)
      } catch (error) {
        extractionError = "ocr_failed"
        console.error("chat attachment OCR failed", {
          reason: error instanceof Error ? error.message : "unknown",
        })
      }
    } else {
      extractionError = "ai_unavailable"
    }
  } else {
    // A file already saved as a CV version was read once at upload: reuse that text.
    const stored = await storedCvText(ctx, bytes)
    const extracted = stored
      ? { text: stored, error: null }
      : await extractText(bytes, type)
    text = extracted.text
    extractionError = extracted.error
    kind = classifyDocumentText(text, name)
  }
  const truncated = text.length > MAX_ATTACHMENT_TEXT_CHARS
  const attachment: ChatAttachment = {
    id,
    path,
    name,
    kind,
    type,
    text: text.slice(0, MAX_ATTACHMENT_TEXT_CHARS),
    truncated,
    image,
    extractionError,
  }

  const storage = ctx.supabase.storage.from(ATTACHMENT_BUCKET)
  const upload = await storage.upload(path, bytes, {
    contentType: ATTACHMENT_MIME[type],
    upsert: false,
  })
  if (upload.error)
    throw new Error(`attachment upload failed: ${upload.error.message}`)
  const meta = await storage.upload(
    `${path}.json`,
    new TextEncoder().encode(JSON.stringify(attachment)),
    { contentType: "application/json", upsert: false }
  )
  if (meta.error) {
    await storage.remove([path])
    throw new Error(`attachment meta upload failed: ${meta.error.message}`)
  }
  await audit({
    userId: ctx.user.id,
    actor: "usuario",
    action: "chat.attachment_uploaded",
    targetType: "conversation",
    targetId: conversationId,
    details: { type, kind, bytes: bytes.byteLength, extractionError },
  })
  return { ok: true, attachment }
}

export function ownsAttachmentPath(ctx: UserContext, path: string): boolean {
  return (
    path.startsWith(`${ctx.user.id}/chat/`) &&
    !path.includes("..") &&
    /\.(pdf|docx|txt|png|jpg|webp)$/.test(path)
  )
}

/** Loads parsed attachments (meta sidecar) for refs the user owns. */
export async function loadChatAttachments(
  ctx: UserContext,
  refs: ChatAttachmentRef[]
): Promise<ChatAttachment[]> {
  const storage = ctx.supabase.storage.from(ATTACHMENT_BUCKET)
  const loaded = await Promise.all(
    refs
      .filter((ref) => ownsAttachmentPath(ctx, ref.path))
      .map(async (ref) => {
        const { data, error } = await storage.download(`${ref.path}.json`)
        if (error || !data) return null
        try {
          const parsed = metaSchema.safeParse(JSON.parse(await data.text()))
          return parsed.success && parsed.data.path === ref.path
            ? parsed.data
            : null
        } catch {
          return null
        }
      })
  )
  return loaded.filter((item): item is ChatAttachment => item !== null)
}

export async function downloadAttachmentFile(
  ctx: UserContext,
  ref: Pick<ChatAttachmentRef, "path" | "name" | "type">
): Promise<File | null> {
  if (!ownsAttachmentPath(ctx, ref.path)) return null
  const { data, error } = await ctx.supabase.storage
    .from(ATTACHMENT_BUCKET)
    .download(ref.path)
  if (error || !data) return null
  return new File([await data.arrayBuffer()], ref.name, {
    type: ATTACHMENT_MIME[ref.type],
  })
}
