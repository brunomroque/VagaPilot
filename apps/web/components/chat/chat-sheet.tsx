"use client"

import { MessageSquareTextIcon } from "lucide-react"
import { usePathname } from "next/navigation"
import { useTranslations } from "next-intl"
import type { UIMessage } from "ai"

import { captureChatOpened } from "@/lib/analytics/chat-events"
import type { ChatScreenContext } from "@/lib/chat/screens"
import type { NextStepsPayload } from "@/lib/chat/next-steps"
import { Button } from "@workspace/ui/components/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@workspace/ui/components/sheet"

import { ChatView } from "./chat-view"
import type { CvOption } from "./job-card-view"
import type { PendingQuestionView } from "./pending-questions-panel"
import { useChatSheet } from "./chat-sheet-context"

export function ChatSheetLauncher({
  conversationId,
  initialMessages,
  cvOptions,
  pendingQuestions,
  nextSteps,
}: {
  conversationId: string
  initialMessages: UIMessage[]
  cvOptions: CvOption[]
  pendingQuestions: PendingQuestionView[]
  nextSteps: NextStepsPayload | null
}) {
  const t = useTranslations("Chat.sheet")
  const pathname = usePathname()
  const { open, setOpen, screenContext } = useChatSheet()
  const hideFab = pathname === "/app" || pathname.startsWith("/app/chat")

  return (
    <>
      {!hideFab ? (
        <Button
          type="button"
          size="lg"
          className="fixed right-4 bottom-4 z-40 shadow-lg md:right-8 md:bottom-8"
          aria-label={t("fab")}
          onClick={() => {
            captureChatOpened("sheet")
            setOpen(true)
          }}
        >
          <MessageSquareTextIcon data-icon="inline-start" />
          {t("fabShort")}
        </Button>
      ) : null}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 p-0 sm:max-w-lg"
        >
          <SheetHeader className="border-b px-4 py-3">
            <SheetTitle>{t("title")}</SheetTitle>
            <SheetDescription>
              {t("contextHint", { screen: screenContext.screen })}
            </SheetDescription>
          </SheetHeader>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-4">
            <ChatView
              key={`sheet-${conversationId}`}
              conversationId={conversationId}
              initialMessages={initialMessages}
              cvOptions={cvOptions}
              initialPrompt={null}
              pendingQuestions={pendingQuestions}
              nextSteps={nextSteps}
              screenContext={screenContext}
              variant="sheet"
              hideHeader
            />
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
