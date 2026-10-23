import "server-only"

import { canComplete, loadOnboardingState } from "@/lib/onboarding/server"
import type { UserContext } from "@/lib/server/context"

export type NextStepItem = {
  id: string
  title: string
  description?: string
  href?: string
  prompt?: string
}

export type NextStepsPayload = {
  kind: "next_steps"
  items: NextStepItem[]
  summary: string
}

/** Deterministic opening card (spec 3.2) — no LLM. */
export async function buildNextSteps(
  ctx: UserContext
): Promise<NextStepsPayload> {
  const items: NextStepItem[] = []

  const onboarding = await loadOnboardingState(ctx)
  if (!onboarding.completedAt && !canComplete(onboarding.requirements)) {
    items.push({
      id: "profile_incomplete",
      title: "Completar perfil",
      description: "CV, pretensão e preferências básicas.",
      href: "/app/onboarding",
      prompt: "Quero completar meu perfil pelo chat.",
    })
  }

  const { data: questions } = await ctx.supabase
    .from("pending_questions")
    .select("id, question_text")
    .eq("user_id", ctx.user.id)
    .eq("status", "aberta")
    .order("created_at", { ascending: true })
    .limit(5)
  for (const row of (questions ?? []) as {
    id: string
    question_text: string
  }[]) {
    items.push({
      id: `question_${row.id}`,
      title: "Responder pergunta pendente",
      description: row.question_text.slice(0, 120),
      prompt: `Quero responder a pergunta pendente: ${row.question_text}`,
    })
  }

  const { count: approvalCount } = await ctx.supabase
    .from("approvals")
    .select("id", { count: "exact", head: true })
    .eq("user_id", ctx.user.id)
    .eq("status", "pendente")
  if ((approvalCount ?? 0) > 0) {
    items.push({
      id: "approvals_pending",
      title: "Aprovações pendentes",
      description: `${approvalCount} aguardando sua decisão.`,
      href: "/app/chat",
      prompt: "Mostrar minhas aprovações pendentes.",
    })
  }

  const pending = await ctx.supabase
    .from("applications")
    .select("id, company, role_title, next_action, next_action_due_at")
    .eq("user_id", ctx.user.id)
    .not("next_action", "is", null)
    .order("next_action_due_at", { ascending: true, nullsFirst: false })
    .limit(3)
  for (const row of (pending.data ?? []) as {
    id: string
    company: string
    role_title: string
    next_action: string
    next_action_due_at: string | null
  }[]) {
    items.push({
      id: `action_${row.id}`,
      title: row.next_action,
      description: `${row.company} · ${row.role_title}`,
      href: "/app/acoes",
    })
  }

  const summary =
    items.length === 0
      ? "Tudo em dia por aqui. Cole um link de vaga ou me diga como posso ajudar."
      : `${items.length} ${items.length === 1 ? "item" : "itens"} para você revisar.`

  return { kind: "next_steps", items, summary }
}
