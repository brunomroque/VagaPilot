import Link from "next/link"
import { RocketIcon } from "lucide-react"
import { getTranslations } from "next-intl/server"

import { OverviewCompact } from "@/components/app/overview-compact"
import { NotConfigured } from "@/components/app/not-configured"
import { ChatView } from "@/components/chat/chat-view"
import { loadChatBootstrap } from "@/lib/chat/bootstrap"
import { loadOnboardingState } from "@/lib/onboarding/server"
import { getUserContext } from "@/lib/server/context"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert"
import { buttonVariants } from "@workspace/ui/components/button"

/** Chat-first home (spec 3.1). */
export default async function HomeChatPage() {
  const t = await getTranslations("Onboarding.chatCta")
  const tChat = await getTranslations("Chat")
  const tHome = await getTranslations("AppHome")
  const context = await getUserContext()
  if (!context.ok) return <NotConfigured title={tHome("title")} />
  const { ctx } = context

  const [onboarding, bootstrap] = await Promise.all([
    loadOnboardingState(ctx),
    loadChatBootstrap(ctx),
  ])

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{tHome("title")}</h1>
        <p className="text-muted-foreground">{tHome("subtitle")}</p>
      </div>
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
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,22rem)]">
        <ChatView
          key={bootstrap.conversationId}
          conversationId={bootstrap.conversationId}
          initialMessages={bootstrap.initialMessages}
          cvOptions={bootstrap.cvOptions}
          initialPrompt={null}
          pendingQuestions={bootstrap.pendingQuestions}
          nextSteps={bootstrap.nextSteps}
          screenContext={{
            screen: "home",
            pathname: "/app",
          }}
          variant="home"
        />
        <aside className="hidden lg:block">
          <OverviewCompact />
        </aside>
      </div>
    </div>
  )
}
