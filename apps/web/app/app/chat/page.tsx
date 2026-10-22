import Link from "next/link"
import { RocketIcon } from "lucide-react"
import { getTranslations } from "next-intl/server"

import { ChatView } from "@/components/chat/chat-view"
import { NotConfigured } from "@/components/app/not-configured"
import {
  defaultConversation,
  findConversation,
  loadUIMessages,
} from "@/lib/chat/conversations"
import { loadOnboardingState } from "@/lib/onboarding/server"
import { getUserContext } from "@/lib/server/context"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert"
import { buttonVariants } from "@workspace/ui/components/button"

const CV_LANGUAGE_LABEL: Record<string, string> = {
  "pt-BR": "PT",
  en: "EN",
  es: "ES",
}

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
  const conversation = requested ?? (await defaultConversation(ctx))
  const [messages, versions, pendingQuestions] = await Promise.all([
    loadUIMessages(ctx, conversation.id),
    ctx.supabase
      .from("cv_versions")
      .select("id, label, language")
      .eq("user_id", ctx.user.id)
      .order("label"),
    ctx.supabase
      .from("pending_questions")
      .select("id, application_id, question_text, options, proposed_answer")
      .eq("user_id", ctx.user.id)
      .eq("status", "aberta")
      .order("created_at", { ascending: true }),
  ])
  const cvOptions = (
    (versions.data ?? []) as { id: string; label: string; language: string }[]
  ).map((cv) => ({
    id: cv.id,
    label: `${cv.label} · ${CV_LANGUAGE_LABEL[cv.language] ?? cv.language}`,
  }))
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
      <ChatView
        key={conversation.id}
        conversationId={conversation.id}
        initialMessages={messages}
        cvOptions={cvOptions}
        initialPrompt={initialPrompt}
        pendingQuestions={(
          (pendingQuestions.data ?? []) as {
            id: string
            application_id: string
            question_text: string
            options: string[] | null
            proposed_answer: string | null
          }[]
        ).map((row) => ({
          id: row.id,
          applicationId: row.application_id,
          questionText: row.question_text,
          options: row.options ?? [],
          proposedAnswer: row.proposed_answer,
        }))}
      />
    </div>
  )
}
