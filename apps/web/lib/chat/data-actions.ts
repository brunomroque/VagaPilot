import "server-only"

import type { ChatToolOutput } from "@/lib/chat/types"
import type { UserContext } from "@/lib/server/context"

import { isAttachmentIntentId } from "@vagapilot/core/chat-attachments"

import { planAttachmentTurn } from "@/lib/chat/attachment-turn"

import { applyFactDestination, type FactDestination } from "./missing-info"

const FACT_DESTINATIONS = [
  "application_only",
  "save_fact",
  "update_cvs",
  "register_gap",
] as const satisfies readonly FactDestination[]

export type ChatDataActionPayload = {
  action: string
  choice?: string
  pendingQuestionId?: string
  statement?: string
  suggestedUsage?: "cv_relevant" | "form_only"
  attachmentIds?: string[]
}

export async function handleChatDataAction(
  ctx: UserContext,
  conversationId: string,
  data: ChatDataActionPayload
): Promise<ChatToolOutput | ChatToolOutput[]> {
  if (data.action === "attachment_intent") {
    const intent = data.choice
    if (
      !intent ||
      !isAttachmentIntentId(intent) ||
      !data.attachmentIds?.length
    ) {
      return {
        kind: "error",
        code: "invalid_request",
        summary: "Escolha inválida para os anexos.",
      }
    }
    const turn = await planAttachmentTurn(ctx, {
      conversationId,
      messageText: "",
      attachmentIds: data.attachmentIds,
      chosenIntent: intent,
    })
    if (turn.outputs.length === 0) {
      return {
        kind: "error",
        code: "empty",
        summary: "Não foi possível processar os anexos.",
      }
    }
    return turn.outputs
  }

  if (data.action === "fact_destination") {
    const destination = FACT_DESTINATIONS.find((value) => value === data.choice)
    if (
      !destination ||
      !data.pendingQuestionId ||
      !data.statement ||
      !data.suggestedUsage
    ) {
      return {
        kind: "error",
        code: "invalid_request",
        summary: "Dados incompletos para salvar a resposta.",
      }
    }
    return applyFactDestination(ctx, {
      conversationId,
      pendingQuestionId: data.pendingQuestionId,
      destination,
      statement: data.statement,
      suggestedUsage: data.suggestedUsage,
    })
  }
  return {
    kind: "error",
    code: "invalid_request",
    summary: "Ação não reconhecida.",
  }
}
