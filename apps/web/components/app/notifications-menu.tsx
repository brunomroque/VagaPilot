"use client"

import Link from "next/link"
import { startTransition, useState } from "react"
import { BellIcon } from "lucide-react"
import { useFormatter, useTranslations } from "next-intl"

import { isApplicationStatus } from "@vagapilot/core/status"

import { useWorkspace } from "@/components/app/workspace-context"
import { markNotificationsRead } from "@/lib/gmail/actions"
import type { NotificationItem } from "@/lib/gmail/types"
import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"

function text(params: NotificationItem["params"], key: string): string {
  const value = params[key]
  return typeof value === "string" ? value : ""
}

function hrefFor(notification: NotificationItem): string {
  switch (notification.kind) {
    case "status_changed":
      return "/app/candidaturas"
    case "review_needed":
      return "/app/acoes#revise"
    case "deadline_reminder":
      return "/app/acoes"
    case "gmail_error":
      return "/app/configuracoes"
    default: {
      const unreachable: never = notification.kind
      throw new Error(`Unknown notification: ${String(unreachable)}`)
    }
  }
}

/** Topbar bell (RF11.6): Gmail updates, items to review and deadline reminders. */
export function NotificationsMenu() {
  const t = useTranslations("Notifications")
  const tTopbar = useTranslations("Topbar")
  const tStatus = useTranslations("Status")
  const format = useFormatter()
  const { notifications, now } = useWorkspace()
  const [seen, setSeen] = useState(false)
  const unread = seen ? 0 : notifications.filter((item) => !item.readAt).length

  function label(notification: NotificationItem): string {
    const { params } = notification
    switch (notification.kind) {
      case "status_changed": {
        const to = text(params, "to")
        const changed = t("status_changed", {
          company: text(params, "company"),
          status: isApplicationStatus(to) ? tStatus(to) : to,
        })
        // Suggested next step from the e-mail (never an automatic reply).
        const next = text(params, "next_step")
        return next ? `${changed} · ${next}` : changed
      }
      case "review_needed":
        return t("review_needed", { count: Number(params.count ?? 0) })
      case "deadline_reminder": {
        const window = text(params, "window") === "12h" ? "12h" : "48h"
        return t("deadline_reminder", {
          window: t(`windows.${window}`),
          action: text(params, "action"),
          company: text(params, "company"),
        })
      }
      case "gmail_error":
        return t("gmail_error")
      default: {
        const unreachable: never = notification.kind
        throw new Error(`Unknown notification: ${String(unreachable)}`)
      }
    }
  }

  function onOpenChange(open: boolean) {
    if (!open || unread === 0) return
    setSeen(true)
    startTransition(async () => {
      await markNotificationsRead()
    })
  }

  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="icon"
            className="relative"
            aria-label={
              unread > 0
                ? `${tTopbar("notifications")}. ${t("unread", { count: unread })}`
                : tTopbar("notifications")
            }
          />
        }
      >
        <BellIcon />
        {unread > 0 ? (
          <span
            aria-hidden="true"
            className="absolute top-1.5 right-1.5 size-2 rounded-full bg-destructive"
          />
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("title")}</DropdownMenuLabel>
          {notifications.length === 0 ? (
            <DropdownMenuItem disabled>{t("empty")}</DropdownMenuItem>
          ) : (
            notifications.map((notification) => (
              <DropdownMenuItem
                key={notification.id}
                className="flex-col items-start gap-0.5"
                render={<Link href={hrefFor(notification)} />}
              >
                <span
                  className={
                    notification.readAt || seen ? undefined : "font-semibold"
                  }
                >
                  {label(notification)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {format.relativeTime(new Date(notification.createdAt), now)}
                </span>
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
