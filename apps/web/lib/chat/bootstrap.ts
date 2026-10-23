import "server-only"

import type { UIMessage } from "ai"

import { defaultConversation, loadUIMessages } from "@/lib/chat/conversations"
import { buildNextSteps, type NextStepsPayload } from "@/lib/chat/next-steps"
import type { UserContext } from "@/lib/server/context"

const CV_LANGUAGE_LABEL: Record<string, string> = {
  "pt-BR": "PT",
  en: "EN",
  es: "ES",
}

export type ChatBootstrap = {
  conversationId: string
  initialMessages: UIMessage[]
  cvOptions: { id: string; label: string }[]
  pendingQuestions: {
    id: string
    applicationId: string
    questionText: string
    options: string[]
    proposedAnswer: string | null
  }[]
  nextSteps: NextStepsPayload
}

export async function loadChatBootstrap(
  ctx: UserContext
): Promise<ChatBootstrap> {
  const conversation = await defaultConversation(ctx)
  const [messages, versions, pendingQuestions, nextSteps] = await Promise.all([
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
    buildNextSteps(ctx),
  ])
  const cvOptions = (
    (versions.data ?? []) as { id: string; label: string; language: string }[]
  ).map((cv) => ({
    id: cv.id,
    label: `${cv.label} · ${CV_LANGUAGE_LABEL[cv.language] ?? cv.language}`,
  }))
  return {
    conversationId: conversation.id,
    initialMessages: messages,
    cvOptions,
    pendingQuestions: (
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
    })),
    nextSteps,
  }
}
