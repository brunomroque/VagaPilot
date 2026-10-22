import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"

import { verifyGrounding } from "@vagapilot/core/grounding"

import { apiError } from "@/lib/http"
import { authenticateDevice } from "@/lib/ext/http"
import { getAdminClient } from "@/lib/server/admin"
import { audit } from "@/lib/server/audit"

const bodySchema = z.object({
  applicationId: z.uuid(),
  questionText: z.string().min(1).max(500),
  fieldType: z.string().max(40).optional(),
  options: z.array(z.string()).max(40).optional(),
  proposedAnswer: z.string().max(4000).optional(),
  proposedFrom: z
    .object({
      kind: z.enum(["standard_answer", "fact", "profile", "manual"]),
      ref: z.string().optional(),
      factIds: z.array(z.uuid()).optional(),
    })
    .optional(),
})

const listQuerySchema = z.object({
  applicationId: z.uuid(),
})

export async function GET(request: NextRequest) {
  const auth = await authenticateDevice(request)
  if (!auth.ok) return apiError("unauthorized", "Device not authorized.", 401)
  const parsed = listQuerySchema.safeParse({
    applicationId: request.nextUrl.searchParams.get("applicationId"),
  })
  if (!parsed.success) return apiError("invalid_request", "Invalid query.", 400)
  const admin = getAdminClient()
  if (!admin) return apiError("not_configured", "Server not configured.", 503)
  const { data, error } = await admin
    .from("pending_questions")
    .select("id, question_text, answer, status, answered_at")
    .eq("user_id", auth.userId)
    .eq("application_id", parsed.data.applicationId)
    .order("created_at", { ascending: true })
  if (error) return apiError("internal_error", "Could not load questions.", 500)
  return NextResponse.json({
    questions: (data ?? []).map((row) => ({
      id: row.id as string,
      questionText: row.question_text as string,
      answer: (row.answer as string | null) ?? null,
      status: row.status as string,
      answeredAt: (row.answered_at as string | null) ?? null,
    })),
  })
}

export async function POST(request: NextRequest) {
  const auth = await authenticateDevice(request)
  if (!auth.ok) return apiError("unauthorized", "Device not authorized.", 401)
  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success)
    return apiError("invalid_request", "Invalid question payload.", 400)

  const admin = getAdminClient()
  if (!admin) return apiError("not_configured", "Server not configured.", 503)

  const factsRes = await admin
    .from("confirmed_facts")
    .select("id, statement")
    .eq("user_id", auth.userId)
    .eq("status", "confirmado")
  const facts = (factsRes.data ?? []).map((row) => ({
    id: row.id as string,
    statement: row.statement as string,
  }))

  const proposed = parsed.data.proposedAnswer?.trim()
  if (proposed && parsed.data.proposedFrom?.factIds?.length) {
    const grounding = verifyGrounding(
      proposed,
      parsed.data.proposedFrom.factIds,
      facts
    )
    if (!grounding.ok) {
      parsed.data.proposedAnswer = undefined
    }
  }

  const inserted = await admin
    .from("pending_questions")
    .insert({
      user_id: auth.userId,
      application_id: parsed.data.applicationId,
      question_text: parsed.data.questionText,
      field_type: parsed.data.fieldType ?? "text",
      options: parsed.data.options ?? [],
      proposed_answer: parsed.data.proposedAnswer ?? null,
      proposed_from: parsed.data.proposedFrom ?? null,
      status: "aberta",
    })
    .select("id")
    .single()
  if (inserted.error || !inserted.data) {
    return apiError("internal_error", "Could not store question.", 500)
  }

  await audit({
    userId: auth.userId,
    actor: "extensao",
    action: "question.asked",
    targetType: "pending_question",
    targetId: (inserted.data as { id: string }).id,
    details: { application_id: parsed.data.applicationId },
  })

  return NextResponse.json({ id: (inserted.data as { id: string }).id })
}
