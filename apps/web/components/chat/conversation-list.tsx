"use client"

import Link from "next/link"
import { useTranslations } from "next-intl"

import { archiveConversationAction } from "@/app/app/chat/actions"
import { Button } from "@workspace/ui/components/button"

export function ConversationList({
  items,
  activeId,
}: {
  items: { id: string; title: string | null; lastMessageAt: string | null }[]
  activeId: string
}) {
  const t = useTranslations("Chat.conversations")
  if (items.length <= 1) return null
  return (
    <nav aria-label={t("label")} className="flex flex-wrap gap-2 border-b pb-3">
      {items.map((item) => (
        <div key={item.id} className="flex items-center gap-1">
          <Button
            size="sm"
            variant={item.id === activeId ? "default" : "outline"}
            render={<Link href={`/app/chat?c=${item.id}`} />}
          >
            {item.title ?? t("untitled")}
          </Button>
          {item.id === activeId ? (
            <form action={archiveConversationAction}>
              <input type="hidden" name="conversationId" value={item.id} />
              <Button type="submit" size="sm" variant="ghost">
                {t("archive")}
              </Button>
            </form>
          ) : null}
        </div>
      ))}
    </nav>
  )
}
