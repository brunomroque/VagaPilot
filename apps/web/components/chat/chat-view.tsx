"use client"

import { useEffect, useRef, useState } from "react"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport, isToolUIPart, type UIMessage } from "ai"
import {
  BotIcon,
  FileTextIcon,
  ImageIcon,
  LoaderCircleIcon,
  PaperclipIcon,
  PlusIcon,
  XIcon,
  SendHorizontalIcon,
  SparklesIcon,
} from "lucide-react"
import { useTranslations } from "next-intl"

import {
  captureChatMessageSent,
  captureChatOpened,
} from "@/lib/analytics/chat-events"
import type { NextStepsPayload } from "@/lib/chat/next-steps"
import type { ChatScreenContext } from "@/lib/chat/screens"
import type { ChatToolOutput } from "@/lib/chat/types"
import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import { Textarea } from "@workspace/ui/components/textarea"

import type { CvOption } from "./job-card-view"
import {
  PendingQuestionsPanel,
  type PendingQuestionView,
} from "./pending-questions-panel"
import { NextStepsView } from "./next-steps-view"
import { RichText } from "./rich-text"
import { ToolOutputView } from "./tool-output-view"

const MAX_CHARS = 8000
const MAX_FILES = 4
const MAX_FILE_BYTES = 4 * 1024 * 1024
const ACCEPT =
  ".pdf,.docx,.txt,.png,.jpg,.jpeg,.webp,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,image/png,image/jpeg,image/webp"

type AttachmentRef = {
  id: string
  path: string
  name: string
  kind: "cv" | "job_description" | "job_image" | "document"
  type: "pdf" | "docx" | "txt" | "png" | "jpg" | "webp"
}

function errorMessage(error: Error, fallback: string): string {
  try {
    const parsed = JSON.parse(error.message) as { error?: { message?: string } }
    return parsed.error?.message ?? fallback
  } catch {
    const text = error.message?.trim()
    return text && text.length < 300 ? text : fallback
  }
}

/** F7 chat: streaming answers, widgets for tool results, keyboard-first composer (CA7.2). */
export function ChatView({
  conversationId,
  initialMessages,
  cvOptions,
  initialPrompt,
  pendingQuestions = [],
  nextSteps = null,
  screenContext,
  variant = "page",
  hideHeader = false,
}: {
  conversationId: string
  initialMessages: UIMessage[]
  cvOptions: CvOption[]
  initialPrompt: string | null
  pendingQuestions?: PendingQuestionView[]
  nextSteps?: NextStepsPayload | null
  screenContext?: ChatScreenContext
  variant?: "page" | "home" | "sheet"
  hideHeader?: boolean
}) {
  const t = useTranslations("Chat")
  const [input, setInput] = useState("")
  const [files, setFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // QA: typing while "Nova conversa" was still redirecting sent to the old conversation.
  const [switching, setSwitching] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  const sentInitial = useRef(false)

  const [dismissedNextSteps, setDismissedNextSteps] = useState(false)

  const { messages, sendMessage, status } = useChat({
    id: conversationId,
    messages: initialMessages,
    transport: new DefaultChatTransport({
      api: "/api/chat",
      prepareSendMessagesRequest: ({ messages: all, id }) => ({
        body: {
          id,
          message: all[all.length - 1],
          context: screenContext ?? undefined,
        },
      }),
    }),
    onError: (error) => {
      const message = errorMessage(error, t("errors.generic"))
      setNotice(message)
    },
  })

  const busy =
    status === "submitted" || status === "streaming" || uploading || switching

  async function addFiles(list: FileList | null) {
    if (!list) return
    const incoming = Array.from(list)
    const next = [...files]
    for (const file of incoming) {
      // QA: the same file picked twice showed two chips and was uploaded twice.
      if (
        next.some(
          (f) =>
            f.name === file.name &&
            f.size === file.size &&
            f.lastModified === file.lastModified
        )
      ) {
        continue
      }
      if (next.length >= MAX_FILES) {
        setNotice(t("attachments.errors.tooMany", { max: MAX_FILES }))
        break
      }
      if (!/\.(pdf|docx|txt|png|jpe?g|webp)$/i.test(file.name)) {
        setNotice(`${file.name}: ${t("attachments.errors.failed")}`)
        continue
      }
      if (file.size > MAX_FILE_BYTES) {
        setNotice(`${file.name}: ${t("attachments.errors.tooLarge")}`)
        continue
      }
      // QA: a renamed .exe was only rejected at send time. Check the real bytes now.
      if (!(await looksSupported(file))) {
        setNotice(`${file.name}: ${t("attachments.errors.failed")}`)
        continue
      }
      next.push(file)
    }
    setFiles(next)
  }

  async function uploadFiles(): Promise<AttachmentRef[] | null> {
    const form = new FormData()
    form.set("conversationId", conversationId)
    for (const file of files) form.append("files", file)
    setUploading(true)
    try {
      const response = await fetch("/api/chat/attachments", {
        method: "POST",
        body: form,
        // QA: a pasted image sometimes hung ~60 s; give up with a clear error instead.
        signal: AbortSignal.timeout(58_000),
      })
      const body = (await response.json().catch(() => null)) as {
        attachments?: AttachmentRef[]
        error?: { message?: string }
      } | null
      if (!response.ok || !body?.attachments) {
        const message = body?.error?.message ?? t("attachments.errors.failed")
        setNotice(message)
        // QA: the rejected chip stayed in the composer after a 415.
        if (response.status === 415 || response.status === 413) setFiles([])
        return null
      }
      return body.attachments.map(({ id, path, name, kind, type }) => ({
        id,
        path,
        name,
        kind,
        type,
      }))
    } catch {
      setNotice(t("attachments.errors.failed"))
      return null
    } finally {
      setUploading(false)
    }
  }

  useEffect(() => {
    if (variant === "home") captureChatOpened("home")
    else if (variant === "page") captureChatOpened("page")
  }, [variant])

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" })
  }, [messages.length, status])

  useEffect(() => {
    if (!initialPrompt) return
    const timer = setTimeout(() => {
      if (sentInitial.current) return
      sentInitial.current = true
      window.history.replaceState(null, "", `/app/chat?c=${conversationId}`)
      void sendMessage({ text: initialPrompt })
    }, 0)
    return () => clearTimeout(timer)
  }, [initialPrompt, conversationId, sendMessage])

  async function sendWithFiles(text: string) {
    const refs = await uploadFiles()
    if (!refs) return
    captureChatMessageSent()
    void sendMessage({
      parts: [
        { type: "text", text: text || t("attachments.defaultMessage") },
        { type: "data-attachments", data: { items: refs } },
      ],
    } as Parameters<typeof sendMessage>[0])
    setFiles([])
    setInput("")
  }

  function send(text: string) {
    const trimmed = text.trim()
    if (busy) return
    if (files.length > 0) {
      if (trimmed.length > MAX_CHARS) {
        setNotice(
          t("errors.tooLong", { max: MAX_CHARS.toLocaleString("pt-BR") })
        )
        return
      }
      setNotice(null)
      void sendWithFiles(trimmed)
      return
    }
    if (!trimmed) return
    if (trimmed.length > MAX_CHARS) {
      setNotice(t("errors.tooLong", { max: MAX_CHARS.toLocaleString("pt-BR") }))
      return
    }
    setNotice(null)
    captureChatMessageSent()
    void sendMessage({ text: trimmed })
    setInput("")
  }

  function sendDataAction(data: {
    action: "fact_destination"
    choice: string
    pendingQuestionId: string
    statement: string
    suggestedUsage: "cv_relevant" | "form_only"
  }) {
    if (busy) return
    setNotice(null)
    captureChatMessageSent()
    void sendMessage({
      parts: [{ type: "data-action", data }],
    } as Parameters<typeof sendMessage>[0])
  }

  const showNextSteps =
    nextSteps && !dismissedNextSteps && messages.length === 0 && !initialPrompt

  const minHeight =
    variant === "sheet"
      ? "min-h-[min(70svh,40rem)]"
      : "min-h-[calc(100svh-11rem)]"

  return (
    <div className={`flex ${minHeight} flex-col gap-4`}>
      {!hideHeader ? (
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-bold">
            {variant === "home" ? t("homeTitle") : t("title")}
          </h2>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              setSwitching(true)
              // Full navigation to a brand-new id: no stale chat state survives,
              // and the first message creates the conversation with this id.
              window.location.assign(`/app/chat?c=${crypto.randomUUID()}`)
            }}
          >
            <Button
              type="submit"
              variant="outline"
              size="sm"
              disabled={switching || uploading || status === "streaming"}
            >
              {switching ? (
                <LoaderCircleIcon
                  data-icon="inline-start"
                  className="animate-spin"
                />
              ) : (
                <PlusIcon data-icon="inline-start" />
              )}
              {t("newConversation")}
            </Button>
          </form>
        </div>
      ) : null}

      <PendingQuestionsPanel initialQuestions={pendingQuestions} />

      <div
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label={t("logLabel")}
        className="flex flex-1 flex-col gap-4"
        data-testid="chat-log"
      >
        {showNextSteps ? (
          <NextStepsView
            output={nextSteps}
            onResolve={(item) => {
              if (item.prompt) send(item.prompt)
              else if (item.href) window.location.href = item.href
            }}
            onLater={() => setDismissedNextSteps(true)}
          />
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-start gap-3 rounded-xl border bg-card p-4">
            <span className="flex size-10 items-center justify-center rounded-xl bg-secondary text-secondary-foreground">
              <SparklesIcon className="size-5" aria-hidden="true" />
            </span>
            <p className="font-semibold">{t("empty.title")}</p>
            <p className="text-sm text-muted-foreground">
              {t("empty.description")}
            </p>
            <div className="flex flex-wrap gap-2">
              {(["search", "pending", "preference"] as const).map((key) => (
                <Button
                  key={key}
                  variant="outline"
                  size="sm"
                  onClick={() => send(t(`empty.examples.${key}`))}
                >
                  {t(`empty.examples.${key}`)}
                </Button>
              ))}
            </div>
          </div>
        ) : null}
        {messages.map((message, index) => (
          <ChatMessage
            key={message.id}
            message={message}
            isLast={index === messages.length - 1 && !busy}
            active={index === messages.length - 1 && busy}
            cvOptions={cvOptions}
            onAnswer={send}
            onDataAction={sendDataAction}
          />
        ))}
        {status === "submitted" ? (
          <p
            className="flex items-center gap-2 text-sm text-muted-foreground"
            role="status"
          >
            <LoaderCircleIcon
              className="size-4 animate-spin"
              aria-hidden="true"
            />
            {t("thinking")}
          </p>
        ) : null}
        <div ref={endRef} />
      </div>

      {notice ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}

      <form
        className="sticky bottom-0 flex flex-col gap-2 rounded-xl border bg-background/95 p-3 backdrop-blur"
        onSubmit={(event) => {
          event.preventDefault()
          send(input)
        }}
      >
        <label htmlFor="chat-input" className="sr-only">
          {t("inputLabel")}
        </label>
        <Textarea
          id="chat-input"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault()
              send(input)
            }
          }}
          rows={2}
          maxLength={MAX_CHARS + 500}
          placeholder={t("placeholder")}
          aria-describedby="chat-input-hint"
          className="max-h-48 resize-none"
          onPaste={(event) => {
            if (event.clipboardData.files.length > 0) {
              event.preventDefault()
              void addFiles(event.clipboardData.files)
            }
          }}
        />
        {files.length > 0 ? (
          <ul className="flex flex-wrap gap-2" data-testid="chat-attachments">
            {files.map((file, index) => (
              <li
                key={`${file.name}-${index}`}
                className="flex items-center gap-1 rounded-md border bg-muted px-2 py-1 text-xs"
              >
                {file.type.startsWith("image/") ? (
                  <ImageIcon className="size-3.5" aria-hidden="true" />
                ) : (
                  <FileTextIcon className="size-3.5" aria-hidden="true" />
                )}
                <span className="max-w-40 truncate">{file.name}</span>
                <button
                  type="button"
                  className="rounded p-0.5 hover:bg-background"
                  aria-label={t("attachments.remove", { name: file.name })}
                  onClick={() => setFiles(files.filter((_, i) => i !== index))}
                >
                  <XIcon className="size-3" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          data-testid="chat-file-input"
          onChange={(event) => {
            void addFiles(event.target.files)
            event.target.value = ""
          }}
        />
        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy || files.length >= MAX_FILES}
            onClick={() => fileInputRef.current?.click()}
            aria-label={t("attachments.attach")}
            title={t("attachments.hint")}
          >
            <PaperclipIcon />
          </Button>
          <p id="chat-input-hint" className="text-xs text-muted-foreground">
            {input.length > MAX_CHARS - 1000
              ? t("counter", {
                  count: input.length.toLocaleString("pt-BR"),
                  max: MAX_CHARS.toLocaleString("pt-BR"),
                })
              : t("hint")}
          </p>
          <Button
            type="submit"
            size="sm"
            disabled={busy || (!input.trim() && files.length === 0)}
          >
            {uploading ? (
              <LoaderCircleIcon
                data-icon="inline-start"
                className="animate-spin"
              />
            ) : (
              <SendHorizontalIcon data-icon="inline-start" />
            )}
            {uploading ? t("attachments.uploading") : t("send")}
          </Button>
        </div>
      </form>
    </div>
  )
}

function ChatMessage({
  message,
  isLast,
  active,
  cvOptions,
  onAnswer,
  onDataAction,
}: {
  message: UIMessage
  isLast: boolean
  active: boolean
  cvOptions: CvOption[]
  onAnswer: (text: string) => void
  onDataAction: (data: {
    action: "fact_destination"
    choice: string
    pendingQuestionId: string
    statement: string
    suggestedUsage: "cv_relevant" | "form_only"
  }) => void
}) {
  const t = useTranslations("Chat")
  if (message.role === "user") {
    const text = message.parts
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("\n")
    const attached = message.parts.flatMap((part) =>
      part.type === "data-attachments"
        ? ((part as { data?: { items?: AttachmentRef[] } }).data?.items ?? [])
        : []
    )
    return (
      <div
        className="flex flex-col items-end gap-1"
        data-testid="chat-message-user"
      >
        {attached.length > 0 ? (
          <ul className="flex flex-wrap justify-end gap-1">
            {attached.map((item) => (
              <li
                key={item.id}
                className="flex items-center gap-1 rounded-md border bg-muted px-2 py-1 text-xs"
              >
                {item.kind === "job_image" ? (
                  <ImageIcon className="size-3.5" aria-hidden="true" />
                ) : (
                  <FileTextIcon className="size-3.5" aria-hidden="true" />
                )}
                <span className="max-w-40 truncate">{item.name}</span>
                <span className="text-muted-foreground">
                  · {t(`attachments.kinds.${item.kind}`)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {text ? (
          <p className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-4 py-2 text-sm break-words whitespace-pre-wrap text-primary-foreground">
            {text}
          </p>
        ) : null}
      </div>
    )
  }
  return (
    <div className="flex gap-3" data-testid="chat-message-assistant">
      <span
        className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground"
        aria-hidden="true"
      >
        <BotIcon className="size-4" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <span className="sr-only">{t("assistantLabel")}</span>
        {message.parts.map((part, index) => {
          if (part.type === "text") {
            return part.text ? <RichText key={index} text={part.text} /> : null
          }
          if (isToolUIPart(part)) {
            switch (part.state) {
              case "output-available": {
                const output = part.output as ChatToolOutput
                // QA: old option buttons stayed clickable after being answered.
                const stale =
                  !isLast &&
                  (output.kind === "options" || output.kind === "clarification")
                return stale ? (
                  <div
                    key={part.toolCallId}
                    inert
                    aria-disabled="true"
                    className="opacity-60"
                  >
                    <ToolOutputView
                      output={output}
                      cvOptions={cvOptions}
                      onAnswer={onAnswer}
                      onDataAction={onDataAction}
                    />
                  </div>
                ) : (
                  <ToolOutputView
                    key={part.toolCallId}
                    output={output}
                    cvOptions={cvOptions}
                    onAnswer={onAnswer}
                    onDataAction={onDataAction}
                  />
                )
              }
              case "output-error":
                return (
                  <Alert key={part.toolCallId} variant="destructive">
                    <AlertDescription>{part.errorText}</AlertDescription>
                  </Alert>
                )
              case "input-streaming":
              case "input-available":
              case "approval-requested":
              case "approval-responded":
                // QA: "Estou analisando…" stayed on screen after the answer ended.
                if (!active) return null
                return (
                  <p
                    key={part.toolCallId}
                    className="flex items-center gap-2 text-xs text-muted-foreground"
                  >
                    <LoaderCircleIcon
                      className="size-3.5 animate-spin"
                      aria-hidden="true"
                    />
                    {t("working")}
                  </p>
                )
              case "output-denied":
                return null
              default:
                return null
            }
          }
          return null
        })}
      </div>
    </div>
  )
}

/** Sniffs the first bytes so unsupported files never become a chip. */
async function looksSupported(file: File): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 512).arrayBuffer())
  const starts = (...bytes: number[]) => bytes.every((b, i) => head[i] === b)
  const name = file.name.toLowerCase()
  if (name.endsWith(".pdf")) return starts(0x25, 0x50, 0x44, 0x46)
  if (name.endsWith(".docx")) return starts(0x50, 0x4b)
  if (name.endsWith(".png")) return starts(0x89, 0x50, 0x4e, 0x47)
  if (/\.jpe?g$/.test(name)) return starts(0xff, 0xd8, 0xff)
  if (name.endsWith(".webp"))
    return (
      starts(0x52, 0x49, 0x46, 0x46) && head[8] === 0x57 && head[9] === 0x45
    )
  if (name.endsWith(".txt")) return !head.includes(0) && !starts(0x4d, 0x5a)
  return false
}
