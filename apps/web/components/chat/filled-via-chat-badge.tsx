import Link from "next/link"

import { findChatProvenance } from "@/lib/chat/record-links"
import { getUserContext } from "@/lib/server/context"
import { Badge } from "@workspace/ui/components/badge"

/** Selo de proveniência chat-first (spec 3.4, 7.2). */
export async function FilledViaChatBadge({
  tableName,
  recordId,
}: {
  tableName: string
  recordId: string
}) {
  const context = await getUserContext()
  if (!context.ok) return null
  const link = await findChatProvenance(context.ctx, tableName, recordId)
  if (!link) return null
  return (
    <Badge variant="secondary" className="font-normal">
      Preenchido via chat ·{" "}
      <Link
        href={`/app/chat?c=${link.conversationId}`}
        className="underline underline-offset-2"
      >
        ver conversa
      </Link>
    </Badge>
  )
}
