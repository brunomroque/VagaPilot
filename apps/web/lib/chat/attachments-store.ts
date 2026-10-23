import "server-only"

import { randomUUID } from "node:crypto"

import type { StoredAttachmentKind } from "@vagapilot/core/chat-attachments"

import {
  detectCvFileType,
  detectJobImageMime,
  extractJobDocumentText,
  sha256Hex,
  type JobImageMime,
} from "@/lib/chat/attachment-files"
import { uploadCv } from "@/lib/cvs/server"
import type { UserContext } from "@/lib/server/context"

export type ChatAttachmentRow = {
  id: string
  kind: StoredAttachmentKind
  mime_type: string
  file_name: string
  storage_path: string
  cv_version_id: string | null
  extracted_text: string | null
}

export type StoreAttachmentInput = {
  conversationId: string
  messageId?: string | null
  file: File
  kind: StoredAttachmentKind
  messageHint?: string
}

export type StoreAttachmentResult =
  | {
      ok: true
      attachment: ChatAttachmentRow
      cvVersionId?: string
      processing: "pendente" | "pronto" | "falhou"
      proposedFacts?: number
      extractionError?: string | null
    }
  | { ok: false; code: string; message: string }

export async function storeChatAttachment(
  ctx: UserContext,
  input: StoreAttachmentInput
): Promise<StoreAttachmentResult> {
  const bytes = new Uint8Array(await input.file.arrayBuffer())
  const userId = ctx.user.id

  if (input.kind === "cv") {
    const library = await ctx.supabase
      .from("cv_tracks")
      .select("id, name")
      .eq("user_id", userId)
    const tracks = (library.data ?? []) as { id: string; name: string }[]
    const hybrid =
      tracks.find((t) => /hibrid/i.test(t.name)) ?? tracks[0] ?? null

    const uploaded = await uploadCv(ctx, {
      file: input.file,
      trackId: hybrid?.id ?? null,
      language: "pt-BR",
      label: null,
      sourceMessageId: input.messageId ?? null,
    })
    if (!uploaded.ok) {
      return {
        ok: false,
        code: uploaded.error.code,
        message: uploaded.error.message,
      }
    }

    const versionRow = await ctx.supabase
      .from("cv_versions")
      .select("storage_path, file_sha256")
      .eq("id", uploaded.data.id)
      .eq("user_id", userId)
      .maybeSingle()
    const storagePath =
      (versionRow.data as { storage_path: string } | null)?.storage_path ??
      `${userId}/${uploaded.data.id}.pdf`
    const fileSha =
      (versionRow.data as { file_sha256: string } | null)?.file_sha256 ??
      sha256Hex(bytes)

    const attachmentId = randomUUID()
    const insert = await ctx.supabase.from("chat_attachments").insert({
      id: attachmentId,
      user_id: userId,
      conversation_id: input.conversationId,
      message_id: input.messageId ?? null,
      kind: "cv",
      mime_type: input.file.type || "application/pdf",
      file_name: input.file.name,
      storage_path: storagePath,
      file_sha256: fileSha,
      cv_version_id: uploaded.data.id,
      metadata: { via: "cvs_bucket" },
    })
    if (insert.error) {
      return { ok: false, code: "write_failed", message: insert.error.message }
    }

    return {
      ok: true,
      attachment: {
        id: attachmentId,
        kind: "cv",
        mime_type: input.file.type,
        file_name: input.file.name,
        storage_path: storagePath,
        cv_version_id: uploaded.data.id,
        extracted_text: null,
      },
      cvVersionId: uploaded.data.id,
      processing: uploaded.data.status,
      proposedFacts: uploaded.data.proposedFacts,
      extractionError: uploaded.data.extractionError ?? null,
    }
  }

  const id = randomUUID()
  let mimeType = input.file.type
  let extracted: string | null = null

  if (input.kind === "job_image") {
    const imageMime = detectJobImageMime(bytes, input.file.name)
    mimeType = imageMime
    const path = `${userId}/${id}`
    const upload = await ctx.supabase.storage
      .from("chat-attachments")
      .upload(path, bytes, { contentType: imageMime, upsert: false })
    if (upload.error) {
      return {
        ok: false,
        code: "storage_failed",
        message: upload.error.message,
      }
    }
    const insert = await ctx.supabase.from("chat_attachments").insert({
      id,
      user_id: userId,
      conversation_id: input.conversationId,
      message_id: input.messageId ?? null,
      kind: "job_image",
      mime_type: imageMime,
      file_name: input.file.name,
      storage_path: path,
      file_sha256: sha256Hex(bytes),
    })
    if (insert.error) {
      return { ok: false, code: "write_failed", message: insert.error.message }
    }
    return {
      ok: true,
      attachment: {
        id,
        kind: "job_image",
        mime_type: imageMime,
        file_name: input.file.name,
        storage_path: path,
        cv_version_id: null,
        extracted_text: null,
      },
      processing: "pronto",
    }
  }

  try {
    extracted = await extractJobDocumentText(bytes, input.file.name)
    detectCvFileType(bytes, {
      name: input.file.name,
      mimeType: input.file.type,
    })
    mimeType =
      input.file.type ||
      (input.file.name.endsWith(".docx")
        ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        : input.file.name.endsWith(".txt")
          ? "text/plain"
          : "application/pdf")
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not read document"
    return { ok: false, code: "unreadable", message }
  }

  const path = `${userId}/${id}`
  const upload = await ctx.supabase.storage
    .from("chat-attachments")
    .upload(path, bytes, { contentType: mimeType, upsert: false })
  if (upload.error) {
    return { ok: false, code: "storage_failed", message: upload.error.message }
  }

  const insert = await ctx.supabase.from("chat_attachments").insert({
    id,
    user_id: userId,
    conversation_id: input.conversationId,
    message_id: input.messageId ?? null,
    kind: "job_document",
    mime_type: mimeType,
    file_name: input.file.name,
    storage_path: path,
    file_sha256: sha256Hex(bytes),
    extracted_text: extracted,
  })
  if (insert.error) {
    return { ok: false, code: "write_failed", message: insert.error.message }
  }

  return {
    ok: true,
    attachment: {
      id,
      kind: "job_document",
      mime_type: mimeType,
      file_name: input.file.name,
      storage_path: path,
      cv_version_id: null,
      extracted_text: extracted,
    },
    processing: "pronto",
  }
}

export async function loadAttachmentsByIds(
  ctx: UserContext,
  ids: string[]
): Promise<ChatAttachmentRow[]> {
  if (ids.length === 0) return []
  const { data, error } = await ctx.supabase
    .from("chat_attachments")
    .select(
      "id, kind, mime_type, file_name, storage_path, cv_version_id, extracted_text"
    )
    .eq("user_id", ctx.user.id)
    .in("id", ids)
  if (error) throw new Error(error.message)
  return (data ?? []) as ChatAttachmentRow[]
}

export async function downloadAttachmentBytes(
  ctx: UserContext,
  row: ChatAttachmentRow
): Promise<Uint8Array> {
  const bucket =
    row.kind === "cv" && row.cv_version_id ? "cvs" : "chat-attachments"
  let path = row.storage_path
  if (row.kind === "cv" && row.cv_version_id) {
    const version = await ctx.supabase
      .from("cv_versions")
      .select("storage_path")
      .eq("id", row.cv_version_id)
      .eq("user_id", ctx.user.id)
      .maybeSingle()
    path =
      (version.data as { storage_path: string } | null)?.storage_path ?? path
  }
  const file = await ctx.supabase.storage.from(bucket).download(path)
  if (file.error || !file.data) {
    throw new Error(file.error?.message ?? "download failed")
  }
  return new Uint8Array(await file.data.arrayBuffer())
}

export function jobImageMimeFromRow(row: ChatAttachmentRow): JobImageMime {
  if (row.mime_type === "image/png") return "image/png"
  if (row.mime_type === "image/webp") return "image/webp"
  return "image/jpeg"
}
