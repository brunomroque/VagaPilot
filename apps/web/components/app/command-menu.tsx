"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import {
  BriefcaseBusinessIcon,
  MessageSquareTextIcon,
  SettingsIcon,
  UserRoundIcon,
} from "lucide-react"
import { useTranslations } from "next-intl"

import { navItems } from "@/components/app/app-sidebar"
import { useChatSheet } from "@/components/chat/chat-sheet-context"
import { useWorkspace } from "@/components/app/workspace-context"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@workspace/ui/components/command"

export function CommandMenu() {
  const t = useTranslations()
  const router = useRouter()
  const { applications, selectApplication, commandOpen, setCommandOpen } =
    useWorkspace()
  const { openChat } = useChatSheet()

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        setCommandOpen(!commandOpen)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [commandOpen, setCommandOpen])

  function go(href: string) {
    setCommandOpen(false)
    router.push(href)
  }

  const pages = [
    ...navItems.map((item) => ({
      href: item.href,
      icon: item.icon,
      label: t(`Nav.${item.key}`),
    })),
    { href: "/app/perfil", icon: UserRoundIcon, label: t("Nav.profile") },
    {
      href: "/app/configuracoes",
      icon: SettingsIcon,
      label: t("Nav.settings"),
    },
  ]

  return (
    <CommandDialog
      open={commandOpen}
      onOpenChange={setCommandOpen}
      title={t("Command.title")}
      description={t("Command.description")}
    >
      <Command>
        <CommandInput placeholder={t("Command.placeholder")} />
        <CommandList>
          <CommandEmpty>{t("Command.empty")}</CommandEmpty>
          <CommandGroup heading={t("Command.applications")}>
            {applications.map((application) => (
              <CommandItem
                key={application.id}
                value={`${application.company} ${application.roleTitle} ${application.id}`}
                onSelect={() => {
                  setCommandOpen(false)
                  selectApplication(application.id)
                }}
              >
                <BriefcaseBusinessIcon />
                <span className="truncate">
                  {application.company} · {application.roleTitle}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading={t("Command.assistant")}>
            <CommandItem
              value={t("Command.askChat")}
              onSelect={() => {
                setCommandOpen(false)
                openChat()
              }}
            >
              <MessageSquareTextIcon />
              {t("Command.askChat")}
            </CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading={t("Command.pages")}>
            {pages.map((page) => (
              <CommandItem
                key={page.href}
                value={page.label}
                onSelect={() => go(page.href)}
              >
                <page.icon />
                {page.label}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
