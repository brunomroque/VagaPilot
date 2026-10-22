import type { ReactNode } from "react"
import { redirect } from "next/navigation"
import { getFormatter } from "next-intl/server"

import { AppShell } from "@/components/app/app-shell"
import { getCurrentUser, hasAcceptedTerms } from "@/lib/auth/session"
import { loadTrackerData } from "@/lib/tracker/load"

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser()
  if (!user) redirect("/entrar?next=/app")
  if (!(await hasAcceptedTerms(user))) redirect("/aceite")

  const format = await getFormatter()
  const today = format.dateTime(new Date(), {
    weekday: "long",
    day: "numeric",
    month: "long",
  })
  const firstName = user.displayName.split(" ")[0] ?? user.displayName
  const tracker = await loadTrackerData(user)

  return (
    <AppShell
      displayName={user.displayName}
      firstName={firstName}
      today={today}
      tracker={tracker}
      nowIso={new Date().toISOString()}
    >
      {children}
    </AppShell>
  )
}
