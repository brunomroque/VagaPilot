import type { ReactNode } from "react"
import { redirect } from "next/navigation"
import { getFormatter, getTranslations } from "next-intl/server"

import { AppShell } from "@/components/app/app-shell"
import { getCurrentUser, hasAcceptedTerms } from "@/lib/auth/session"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { loadChatBootstrap } from "@/lib/chat/bootstrap"
import { getPlanSnapshot } from "@/lib/entitlements/server"
import { getUserContext } from "@/lib/server/context"
import { loadTrackerData } from "@/lib/tracker/load"

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser()
  if (!user) redirect("/entrar?next=/app")
  if (!(await hasAcceptedTerms(user))) redirect("/aceite")

  const format = await getFormatter()
  const tPlan = await getTranslations("Plan")
  const today = format.dateTime(new Date(), {
    weekday: "long",
    day: "numeric",
    month: "long",
  })
  let firstName = user.firstName
  if (!user.isDevBypass) {
    const supabase = await createSupabaseServerClient()
    if (supabase) {
      const { data: profile } = await supabase
        .from("candidate_profiles")
        .select("first_name")
        .eq("user_id", user.id)
        .maybeSingle()
      const stored = (profile as { first_name?: string | null } | null)
        ?.first_name
      if (stored?.trim()) firstName = stored.trim()
    }
  }
  const tracker = await loadTrackerData(user)
  const snapshot = await getPlanSnapshot(user.id)
  const userContext = await getUserContext()
  const chatBootstrap = userContext.ok
    ? await loadChatBootstrap(userContext.ctx)
    : {
        conversationId: "00000000-0000-4000-8000-000000000001",
        initialMessages: [],
        cvOptions: [],
        pendingQuestions: [],
        nextSteps: { kind: "next_steps" as const, items: [], summary: "" },
      }

  return (
    <AppShell
      displayName={user.displayName}
      firstName={firstName}
      today={today}
      tracker={tracker}
      nowIso={new Date().toISOString()}
      chatBootstrap={chatBootstrap}
      plan={{
        name: snapshot.trialing ? tPlan("trial") : tPlan(snapshot.plan),
        used: snapshot.analysesUsed,
        limit: snapshot.analysesLimit,
        usageLabel:
          snapshot.analysesLimit == null
            ? tPlan("usageUnlimited", { used: snapshot.analysesUsed })
            : tPlan("usage", {
                used: snapshot.analysesUsed,
                limit: snapshot.analysesLimit,
              }),
      }}
    >
      {children}
    </AppShell>
  )
}
