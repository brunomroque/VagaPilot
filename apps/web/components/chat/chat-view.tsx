"use client"

import { useEffect, useRef, useState } from "react"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport, isToolUIPart, type UIMessage } from "ai"
import {
  BotIcon,
  LoaderCircleIcon,
  PlusIcon,
  SendHorizontalIcon,
  SparklesIcon,
} from "lucide-react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"

import { startNewConversationAction } from "@/app/app/chat/actions"
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
import { ToolOutputView } from "./tool-output-view"

const MAX_CHARS = 8000

function errorMessage(error: Error, fallback: string): string {
  try {
    const parsed = JSON.parse(error.message) as { error?: { message?: string } }
    return parsed.error?.message ?? fallback
  } catch {
    return fallback
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
  const [notice, setNotice] = useState<string | null>(null)
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
      toast.error(message)
    },
  })

  const busy = status === "submitted" || status === "streaming"

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

  function send(text: string) {
    const trimmed = text.trim()
    if (!trimmed || busy) return
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
          <form action={startNewConversationAction}>
            <Button type="submit" variant="outline" size="sm">
              <PlusIcon data-icon="inline-start" />
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
        {messages.map((message) => (
          <ChatMessage
            key={message.id}
            message={message}
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
        />
        <div className="flex items-center justify-between gap-2">
          <p id="chat-input-hint" className="text-xs text-muted-foreground">
            {input.length > MAX_CHARS - 1000
              ? t("counter", {
                  count: input.length.toLocaleString("pt-BR"),
                  max: MAX_CHARS.toLocaleString("pt-BR"),
                })
              : t("hint")}
          </p>
          <Button type="submit" size="sm" disabled={busy || !input.trim()}>
            <SendHorizontalIcon data-icon="inline-start" />
            {t("send")}
          </Button>
        </div>
      </form>
    </div>
  )
}

function ChatMessage({
  message,
  cvOptions,
  onAnswer,
  onDataAction,
}: {
  message: UIMessage
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
    return (
      <div className="flex justify-end" data-testid="chat-message-user">
        <p className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-4 py-2 text-sm break-words whitespace-pre-wrap text-primary-foreground">
          {text}
        </p>
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
            return part.text ? (
              <p
                key={index}
                className="text-sm break-words whitespace-pre-wrap"
              >
                {part.text}
              </p>
            ) : null
          }
          if (isToolUIPart(part)) {
            switch (part.state) {
              case "output-available":
                return (
                  <ToolOutputView
                    key={part.toolCallId}
                    output={part.output as ChatToolOutput}
                    cvOptions={cvOptions}
                    onAnswer={onAnswer}
                    onDataAction={onDataAction}
                  />
                )
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
