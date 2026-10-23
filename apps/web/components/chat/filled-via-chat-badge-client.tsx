"use client"

import Link from "next/link"
import { useEffect, useState } from "react"

import { loadChatProvenanceAction } from "@/app/app/chat/actions"
import { Badge } from "@workspace/ui/components/badge"

export function FilledViaChatBadgeClient({
  tableName,
  recordId,
}: {
  tableName: string
  recordId: string
}) {
  const [conversationId, setConversationId] = useState<string | null>(null)
  useEffect(() => {
    void loadChatProvenanceAction({ tableName, recordId }).then((result) => {
      if (result.ok && result.data) {
        setConversationId(result.data.conversationId)
      }
    })
  }, [tableName, recordId])
  if (!conversationId) return null
  return (
    <Badge variant="secondary" className="font-normal">
      Preenchido via chat ·{" "}
      <Link
        href={`/app/chat?c=${conversationId}`}
        className="underline underline-offset-2"
      >
        ver conversa
      </Link>
    </Badge>
  )
}
