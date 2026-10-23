import "server-only"

import { getTranslations } from "next-intl/server"

import { extractJobFromScreenshot } from "@vagapilot/ai"
import {
  classifyAttachmentIntent,
  type AttachmentIntentId,
  type StoredAttachmentKind,
} from "@vagapilot/core/chat-attachments"
import { extractUrls } from "@vagapilot/core/guardrails"

import {
  downloadAttachmentBytes,
  jobImageMimeFromRow,
  loadAttachmentsByIds,
  type ChatAttachmentRow,
} from "@/lib/chat/attachments-store"
import { toolAtsScore } from "@/lib/cvs/chat-cv"
import { loadJobCards, startIngestion } from "@/lib/chat/jobs-server"
import type { ChatToolOutput } from "@/lib/chat/types"
import type { UserContext } from "@/lib/server/context"

function questionForKey(
  key: string,
  t: (
    key:
      | "questions.cv_only"
      | "questions.cv_and_job"
      | "questions.missing_job"
      | "questions.missing_pair"
      | "questions.generic"
  ) => string
): string {
  switch (key) {
    case "cv_only":
      return t("questions.cv_only")
    case "cv_and_job":
      return t("questions.cv_and_job")
    case "missing_job":
      return t("questions.missing_job")
    case "missing_pair":
      return t("questions.missing_pair")
    default:
      return t("questions.generic")
  }
}

function intentLabel(
  key: string,
  t: (
    key:
      | "intents.review_cv"
      | "intents.update_profile_from_cv"
      | "intents.save_cv_version"
      | "intents.analyze_job"
      | "intents.compare_cv_job"
      | "intents.start_apply"
  ) => string
): string {
  switch (key) {
    case "review_cv":
      return t("intents.review_cv")
    case "update_profile_from_cv":
      return t("intents.update_profile_from_cv")
    case "save_cv_version":
      return t("intents.save_cv_version")
    case "analyze_job":
      return t("intents.analyze_job")
    case "compare_cv_job":
      return t("intents.compare_cv_job")
    case "start_apply":
      return t("intents.start_apply")
    default:
      return key
  }
}

export type AttachmentTurnResult = {
  outputs: ChatToolOutput[]
  /** When true, skip the default LLM turn */
  handled: boolean
}

async function waitForCvText(
  ctx: UserContext,
  cvVersionId: string,
  attempts = 8
): Promise<string | null> {
  for (let i = 0; i < attempts; i += 1) {
    const row = await ctx.supabase
      .from("cv_versions")
      .select("extracted_text, extraction_error")
      .eq("id", cvVersionId)
      .eq("user_id", ctx.user.id)
      .maybeSingle()
    const data = row.data as {
      extracted_text: string | null
      extraction_error: string | null
    } | null
    if (!data) return null
    if (data.extracted_text && data.extracted_text.length > 0) {
      return data.extracted_text
    }
    if (data.extraction_error) return null
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
  return null
}

async function reviewCv(
  ctx: UserContext,
  cvVersionId: string,
  summary: string
): Promise<ChatToolOutput> {
  const [version, siblings, facts] = await Promise.all([
    ctx.supabase
      .from("cv_versions")
      .select("label, file_sha256, extracted_text, language")
      .eq("id", cvVersionId)
      .eq("user_id", ctx.user.id)
      .maybeSingle(),
    ctx.supabase
      .from("cv_versions")
      .select("id, label, file_sha256, language")
      .eq("user_id", ctx.user.id)
      .neq("id", cvVersionId),
    ctx.supabase
      .from("confirmed_facts")
      .select("id", { count: "exact", head: true })
      .eq("user_id", ctx.user.id)
      .eq("status", "confirmado"),
  ])
  const row = version.data as {
    label: string
    file_sha256: string
    extracted_text: string | null
    language: string
  } | null
  if (!row) {
    return { kind: "error", code: "not_found", summary }
  }
  const text =
    row.extracted_text && row.extracted_text.length > 0
      ? row.extracted_text
      : await waitForCvText(ctx, cvVersionId)
  if (!text) {
    return {
      kind: "attachment_progress",
      cvVersionId,
      status: "processando",
      summary,
    }
  }
  const sameSha = (
    (siblings.data ?? []) as { label: string; file_sha256: string }[]
  )
    .filter((s) => s.file_sha256 === row.file_sha256)
    .map((s) => s.label)
  const proposed = await ctx.supabase
    .from("confirmed_facts")
    .select("id", { count: "exact", head: true })
    .eq("user_id", ctx.user.id)
    .eq("status", "proposto")
    .filter("source_ref->>cv_version_id", "eq", cvVersionId)
  const proposedCount = proposed.count ?? 0
  const lines = [
    summary,
    sameSha.length > 0
      ? `Este arquivo é idêntico (SHA-256) às versões: ${sameSha.join(", ")}.`
      : "Não encontrei outra versão com o mesmo hash — trate como arquivo novo.",
    `Idioma da versão: ${row.language}.`,
    `Fatos confirmados no perfil: ${facts.count ?? 0}. Fatos propostos deste CV: ${proposedCount}.`,
    "Só posso sugerir alterações com base nos fatos confirmados; nada será aplicado sem seu OK.",
  ]
  return {
    kind: "cv_review",
    cvVersionId,
    lines,
    proposedFacts: proposedCount,
    summary: lines[0] ?? summary,
  }
}

async function ingestFromAttachments(
  ctx: UserContext,
  rows: ChatAttachmentRow[],
  conversationId: string,
  messageText: string
): Promise<ChatToolOutput[]> {
  const tTools = await getTranslations("ChatTools")
  const outputs: ChatToolOutput[] = []
  const urls = extractUrls(messageText)

  if (urls.length > 0) {
    const batch = await startIngestion(ctx, {
      urls,
      conversationId,
    })
    outputs.push({
      kind: "ingest_batch",
      ...batch,
      summary: tTools("ingest", { count: batch.items.length }),
    })
    return outputs
  }

  for (const row of rows) {
    if (row.kind === "job_document" && row.extracted_text) {
      const batch = await startIngestion(ctx, {
        text: row.extracted_text,
        conversationId,
      })
      outputs.push({
        kind: "ingest_batch",
        ...batch,
        summary: tTools("ingest", { count: batch.items.length }),
      })
    }
    if (row.kind === "job_image") {
      const bytes = await downloadAttachmentBytes(ctx, row)
      const { data } = await extractJobFromScreenshot(
        bytes,
        jobImageMimeFromRow(row)
      )
      if (data.url) {
        const batch = await startIngestion(ctx, {
          urls: [data.url],
          conversationId,
        })
        outputs.push({
          kind: "ingest_batch",
          ...batch,
          summary: tTools("ingest", { count: batch.items.length }),
        })
      } else if (data.title || data.company) {
        const text = [
          data.title ? `Cargo: ${data.title}` : null,
          data.company ? `Empresa: ${data.company}` : null,
          data.location ? `Local: ${data.location}` : null,
        ]
          .filter(Boolean)
          .join("\n")
        const batch = await startIngestion(ctx, { text, conversationId })
        outputs.push({
          kind: "ingest_batch",
          ...batch,
          summary: tTools("ingest", { count: batch.items.length }),
        })
      } else {
        outputs.push({
          kind: "options",
          question: (await getTranslations("Chat.attach"))("needJobLink"),
          options: [],
          allowFreeText: true,
          summary: (await getTranslations("Chat.attach"))("ocrEmpty"),
        })
      }
    }
  }
  return outputs
}

export async function buildAttachmentFileOutputs(
  stored: {
    attachment: ChatAttachmentRow
    cvVersionId?: string
    processing?: "pendente" | "pronto" | "falhou"
    proposedFacts?: number
  }[]
): Promise<ChatToolOutput[]> {
  const t = await getTranslations("Chat.attach")
  return stored.map((item) => {
    if (item.attachment.kind === "cv" && item.cvVersionId) {
      return {
        kind: "file_upload",
        attachmentId: item.attachment.id,
        fileName: item.attachment.file_name,
        mimeType: item.attachment.mime_type,
        cvVersionId: item.cvVersionId,
        summary: t("cvReceived", { name: item.attachment.file_name }),
      }
    }
    return {
      kind: "file_upload",
      attachmentId: item.attachment.id,
      fileName: item.attachment.file_name,
      mimeType: item.attachment.mime_type,
      summary: t("fileReceived", { name: item.attachment.file_name }),
    }
  })
}

export async function runAttachmentIntent(
  ctx: UserContext,
  input: {
    conversationId: string
    intent: AttachmentIntentId
    attachmentIds: string[]
    messageText: string
  }
): Promise<AttachmentTurnResult> {
  const t = await getTranslations("Chat.attach")
  const rows = await loadAttachmentsByIds(ctx, input.attachmentIds)
  const kinds = rows.map((r) => r.kind as StoredAttachmentKind)
  const cvRow = rows.find((r) => r.kind === "cv" && r.cv_version_id)
  const cvVersionId = cvRow?.cv_version_id ?? null
  const outputs: ChatToolOutput[] = []

  switch (input.intent) {
    case "save_cv_version":
      outputs.push({
        kind: "deep_link",
        href: "/app/cvs",
        label: t("openCvs"),
        summary: t("cvSaved"),
      })
      break
    case "update_profile_from_cv":
      outputs.push({
        kind: "deep_link",
        href: "/app/fatos",
        label: t("openFacts"),
        summary: t("reviewProposedFacts"),
      })
      break
    case "review_cv":
      if (!cvVersionId) {
        outputs.push({
          kind: "error",
          code: "missing_cv",
          summary: t("missingCv"),
        })
        break
      }
      outputs.push(await reviewCv(ctx, cvVersionId, t("reviewStarted")))
      break
    case "analyze_job":
      outputs.push(
        ...(await ingestFromAttachments(
          ctx,
          rows,
          input.conversationId,
          input.messageText
        ))
      )
      break
    case "compare_cv_job": {
      const ingested = await ingestFromAttachments(
        ctx,
        rows,
        input.conversationId,
        input.messageText
      )
      outputs.push(...ingested)
      const batch = ingested.find((o) => o.kind === "ingest_batch")
      const matchId =
        batch?.kind === "ingest_batch" ? batch.items[0]?.jobMatchId : null
      if (cvVersionId && matchId) {
        const cards = await loadJobCards(ctx, [matchId])
        const postingId = cards[0]?.postingId
        if (postingId) {
          outputs.push(
            await toolAtsScore(
              ctx,
              {
                cvVersionId,
                jobPostingId: postingId,
                jobMatchId: matchId,
              },
              t("atsStarted")
            )
          )
        }
      } else {
        outputs.push({
          kind: "options",
          question: t("compareWhenReady"),
          options: [t("intents.analyze_job")],
          summary: t("compareWhenReady"),
        })
      }
      break
    }
    case "start_apply": {
      const ingested = await ingestFromAttachments(
        ctx,
        rows,
        input.conversationId,
        input.messageText
      )
      outputs.push(...ingested)
      const batch = ingested.find((o) => o.kind === "ingest_batch")
      const matchId =
        batch?.kind === "ingest_batch" ? batch.items[0]?.jobMatchId : null
      if (matchId) {
        const cards = await loadJobCards(ctx, [matchId])
        const card = cards[0]
        if (card) {
          outputs.push({
            kind: "job_card",
            jobMatchId: matchId,
            summary: t("jobReady"),
            fit: card.fit,
            reasons: card.reasons.map((r) => r.text),
            gaps: card.gaps.map((g) => g.requirement),
            alerts: card.alerts.map((a) => a.message),
          })
        }
      }
      break
    }
    default: {
      const unreachable: never = input.intent
      throw new Error(`Unhandled intent: ${String(unreachable)}`)
    }
  }

  return { outputs, handled: true }
}

export async function planAttachmentTurn(
  ctx: UserContext,
  input: {
    conversationId: string
    messageText: string
    attachmentIds: string[]
    chosenIntent?: AttachmentIntentId
  }
): Promise<AttachmentTurnResult> {
  const rows = await loadAttachmentsByIds(ctx, input.attachmentIds)
  if (rows.length === 0) {
    return {
      handled: false,
      outputs: [
        {
          kind: "error",
          code: "not_found",
          summary: "Anexos não encontrados.",
        },
      ],
    }
  }

  if (input.chosenIntent) {
    return runAttachmentIntent(ctx, {
      conversationId: input.conversationId,
      intent: input.chosenIntent,
      attachmentIds: input.attachmentIds,
      messageText: input.messageText,
    })
  }

  const kinds = rows.map((r) => r.kind as StoredAttachmentKind)
  const plan = classifyAttachmentIntent(input.messageText, kinds)
  const t = await getTranslations("Chat.attach")

  if (plan.mode === "clarify") {
    const question = questionForKey(plan.questionKey, t)
    return {
      handled: true,
      outputs: [
        {
          kind: "attachment_intent",
          attachmentIds: input.attachmentIds,
          question,
          options: plan.options.map((option) => ({
            id: option.id,
            label: intentLabel(option.labelKey, t),
          })),
          summary: question,
        },
      ],
    }
  }

  const intent =
    plan.mode === "explicit" || plan.mode === "auto"
      ? plan.intent
      : "analyze_job"

  return runAttachmentIntent(ctx, {
    conversationId: input.conversationId,
    intent,
    attachmentIds: input.attachmentIds,
    messageText: input.messageText,
  })
}
