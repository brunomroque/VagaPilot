"use client"

import { useRef, useState } from "react"
import { PaperclipIcon, XIcon } from "lucide-react"
import { useTranslations } from "next-intl"

import { Button } from "@workspace/ui/components/button"

export type PendingAttachment = {
  id: string
  fileName: string
  kind: "cv" | "job_image" | "job_document"
  cvVersionId?: string
}

const ACCEPT =
  ".pdf,.docx,.txt,.png,.jpg,.jpeg,.webp,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,image/png,image/jpeg,image/webp"

export function ComposerAttachments({
  conversationId,
  messageHint,
  disabled,
  items,
  onChange,
}: {
  conversationId: string
  messageHint: string
  disabled?: boolean
  items: PendingAttachment[]
  onChange: (items: PendingAttachment[]) => void
}) {
  const t = useTranslations("Chat.attach")
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function uploadFiles(fileList: FileList | null) {
    const files = [...(fileList ?? [])]
    if (files.length === 0) return
    setError(null)
    setUploading(true)
    const next: PendingAttachment[] = [...items]
    try {
      for (const file of files.slice(0, 6 - items.length)) {
        const body = new FormData()
        body.set("file", file)
        body.set("conversationId", conversationId)
        body.set("role", "auto")
        if (messageHint.trim()) body.set("messageHint", messageHint.trim())
        const response = await fetch("/api/chat/attachments", {
          method: "POST",
          body,
        })
        const payload = (await response.json().catch(() => null)) as {
          id: string
          kind: PendingAttachment["kind"]
          fileName: string
          cvVersionId?: string | null
          error?: { code?: string; message?: string }
        } | null
        if (!response.ok) {
          const code = payload?.error?.code
          throw new Error(
            code && code in { unsupported_type: 1, file_too_large: 1 }
              ? t(`errors.${code as "unsupported_type"}`)
              : t("errors.unknown")
          )
        }
        if (!payload || !("id" in payload)) throw new Error(t("errors.unknown"))
        next.push({
          id: payload.id,
          fileName: payload.fileName,
          kind: payload.kind,
          cvVersionId: payload.cvVersionId ?? undefined,
        })
      }
      onChange(next)
    } catch (uploadError) {
      setError(
        uploadError instanceof Error ? uploadError.message : t("errors.unknown")
      )
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ""
    }
  }

  function remove(id: string) {
    onChange(items.filter((item) => item.id !== id))
  }

  return (
    <div className="flex flex-col gap-2">
      {items.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center gap-1 rounded-full border bg-muted px-2 py-1 text-xs"
            >
              <span className="max-w-[12rem] truncate">{item.fileName}</span>
              <button
                type="button"
                className="rounded-full p-0.5 hover:bg-background"
                aria-label={t("remove", { name: item.fileName })}
                onClick={() => remove(item.id)}
              >
                <XIcon className="size-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <div>
        <input
          ref={inputRef}
          type="file"
          className="sr-only"
          multiple
          accept={ACCEPT}
          onChange={(event) => void uploadFiles(event.target.files)}
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled || uploading || items.length >= 6}
          onClick={() => inputRef.current?.click()}
        >
          <PaperclipIcon data-icon="inline-start" />
          {uploading ? t("uploading") : t("attach")}
        </Button>
      </div>
    </div>
  )
}
