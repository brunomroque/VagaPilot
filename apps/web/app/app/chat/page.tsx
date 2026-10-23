import Link from "next/link"
import { RocketIcon } from "lucide-react"
import { getTranslations } from "next-intl/server"

import { ChatView } from "@/components/chat/chat-view"
import { ConversationList } from "@/components/chat/conversation-list"
import { NotConfigured } from "@/components/app/not-configured"
import { loadChatBootstrap } from "@/lib/chat/bootstrap"
import { findConversation, listConversations } from "@/lib/chat/conversations"
import { loadOnboardingState } from "@/lib/onboarding/server"
import { getUserContext } from "@/lib/server/context"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert"
import { buttonVariants } from "@workspace/ui/components/button"

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; analisar?: string }>
}) {
  const t = await getTranslations("Onboarding.chatCta")
  const tChat = await getTranslations("Chat")
  const params = await searchParams
  const context = await getUserContext()
  if (!context.ok) return <NotConfigured title={tChat("title")} />
  const { ctx } = context

  const onboarding = await loadOnboardingState(ctx)
  const requested =
    params.c && /^[0-9a-f-]{36}$/i.test(params.c)
      ? await findConversation(ctx, params.c)
      : null
  const bootstrap = await loadChatBootstrap(ctx)
  const conversation = requested ?? {
    id: bootstrap.conversationId,
    title: null,
    created_at: "",
  }
  const conversations = await listConversations(ctx)
  const initialPrompt = params.analisar?.trim().slice(0, 8000) || null

  return (
    <div className="flex flex-col gap-4">
      {onboarding && !onboarding.completedAt ? (
        <Alert>
          <RocketIcon />
          <AlertTitle>{t("title")}</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-2">
            {t("description")}
            <Link
              href="/app/onboarding"
              className={buttonVariants({ size: "sm" })}
            >
              {t("action")}
            </Link>
          </AlertDescription>
        </Alert>
      ) : null}
      <ConversationList
        activeId={conversation.id}
        items={conversations.map((row) => ({
          id: row.id,
          title: row.title,
          lastMessageAt: row.last_message_at ?? null,
        }))}
      />
      <ChatView
        key={conversation.id}
        conversationId={conversation.id}
        initialMessages={
          conversation.id === bootstrap.conversationId
            ? bootstrap.initialMessages
            : await import("@/lib/chat/conversations").then((m) =>
                m.loadUIMessages(ctx, conversation.id)
              )
        }
        cvOptions={bootstrap.cvOptions}
        initialPrompt={initialPrompt}
        pendingQuestions={bootstrap.pendingQuestions}
        nextSteps={bootstrap.nextSteps}
        screenContext={{ screen: "chat", pathname: "/app/chat" }}
        variant="page"
      />
    </div>
  )
}
