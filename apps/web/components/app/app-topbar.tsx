"use client"

import { PlusIcon, SearchIcon } from "lucide-react"
import { useTranslations } from "next-intl"

import { NotificationsMenu } from "@/components/app/notifications-menu"
import { useWorkspace } from "@/components/app/workspace-context"
import { Button } from "@workspace/ui/components/button"
import { Kbd, KbdGroup } from "@workspace/ui/components/kbd"
import { Separator } from "@workspace/ui/components/separator"
import { SidebarTrigger } from "@workspace/ui/components/sidebar"

export function AppTopbar({
  firstName,
  today,
}: {
  firstName: string
  today: string
}) {
  const t = useTranslations("Topbar")
  const { setAnalyzeOpen, setCommandOpen } = useWorkspace()

  return (
    <header className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b bg-background/90 px-4 py-4 backdrop-blur md:px-8 md:py-6">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <SidebarTrigger aria-label={t("toggleSidebar")} />
        <Separator orientation="vertical" className="h-8 md:hidden" />
        <div className="flex min-w-0 flex-col">
          <p className="text-xs font-medium text-muted-foreground first-letter:uppercase md:text-sm">
            {today}
          </p>
          <h1 className="text-lg leading-tight font-bold tracking-tight text-balance md:truncate md:text-2xl">
            {t("greeting", { name: firstName })}
          </h1>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          onClick={() => setCommandOpen(true)}
          aria-label={t("search")}
        >
          <SearchIcon data-icon="inline-start" />
          <span className="hidden lg:inline">{t("search")}</span>
          <KbdGroup className="hidden lg:inline-flex">
            <Kbd>Ctrl</Kbd>
            <Kbd>K</Kbd>
          </KbdGroup>
        </Button>
        <NotificationsMenu />
        <Button size="lg" onClick={() => setAnalyzeOpen(true)}>
          <PlusIcon data-icon="inline-start" />
          <span className="hidden sm:inline">{t("analyze")}</span>
          <span className="sr-only sm:hidden">{t("analyze")}</span>
        </Button>
      </div>
    </header>
  )
}
