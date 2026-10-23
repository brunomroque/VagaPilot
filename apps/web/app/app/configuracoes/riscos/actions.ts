"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { GMAIL_SEND_SCOPE, sendGmailMessage } from "@vagapilot/gmail"
import { createMailerFromEnv } from "@vagapilot/jobs"
import {
  LEGAL_CURRENT_VERSIONS,
  allClausesChecked,
  sessionIsFresh,
  typedConfirmationOk,
  type LegalSlug,
} from "@vagapilot/core/legal"

import { getGmailRuntime } from "@/lib/gmail/runtime"
import {
  appendEvidence,
  buildCertificate,
  loadCurrentLegalDocuments,
  requestMeta,
  sessionIdFromClaims,
} from "@/lib/legal/server"
import { cancelActiveApplyRuns } from "@/lib/apply/server"
import { audit } from "@/lib/server/audit"
import { getUserContext } from "@/lib/server/context"
import { getFieldCrypto } from "@/lib/server/field-crypto"

type Result<T> = { ok: true; data: T } | { ok: false; error: string }

const slugSchema = z.enum(Object.keys(LEGAL_CURRENT_VERSIONS) as [LegalSlug, ...LegalSlug[]])

const acceptSchema = z.object({
  slug: slugSchema,
  version: z.string().min(1).max(40),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  checkboxes: z.record(z.string(), z.boolean()),
  typedConfirmation: z.string().max(200).nullable(),
  scrolledToEnd: z.literal(true),
})

/** Clickwrap acceptance of ONE document version (the text the user saw, by hash). */
export async function acceptLegalDocumentAction(
  input: unknown
): Promise<Result<{ recordId: string }>> {
  const parsed = acceptSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: "Leia o texto até o fim e marque cada item." }
  const auth = await getUserContext()
  if (!auth.ok) return { ok: false, error: "Entre novamente." }
  const { ctx } = auth
  const { data: userData } = await ctx.supabase.auth.getUser()
  if (!ctx.user.isDevBypass && !sessionIsFresh(userData.user?.last_sign_in_at))
    return { ok: false, error: "reauth_required" }
  const docs = await loadCurrentLegalDocuments()
  const doc = docs[parsed.data.slug]
  if (!doc || doc.version !== parsed.data.version || doc.sha256 !== parsed.data.sha256)
    return { ok: false, error: "O texto mudou. Recarregue a página e leia a nova versão." }
  if (!doc.publishable)
    return { ok: false, error: "Esta versão ainda não foi publicada (dados da empresa pendentes)." }
  if (!allClausesChecked(doc.slug, parsed.data.checkboxes))
    return { ok: false, error: "Marque cada item separadamente para aceitar." }
  if (!typedConfirmationOk(parsed.data.typedConfirmation, ctx.user.displayName))
    return { ok: false, error: "Digite ACEITO ou seu nome completo, ou deixe em branco." }
  const { data: claims } = await ctx.supabase.auth.getClaims()
  const meta = await requestMeta()
  const record = await appendEvidence({
    user_id: ctx.user.id,
    email: ctx.user.email,
    action: "accept",
    document_id: doc.id,
    document_slug: doc.slug,
    document_version: doc.version,
    document_sha256: doc.sha256,
    checkboxes: parsed.data.checkboxes,
    typed_confirmation: parsed.data.typedConfirmation?.trim() || null,
    ip: meta.ip,
    user_agent: meta.userAgent,
    session_id: sessionIdFromClaims(claims?.claims as Record<string, unknown> | undefined),
    locale: meta.locale,
  })
  if (!record) return { ok: false, error: "Não foi possível registrar o aceite." }
  await audit({
    userId: ctx.user.id,
    actor: "usuario",
    action: "legal.accepted",
    targetType: "legal_acceptance",
    targetId: record.id,
    details: { slug: doc.slug, version: doc.version, sha256: doc.sha256 },
  }).catch(() => undefined)
  revalidatePath("/app/configuracoes/riscos")
  return { ok: true, data: { recordId: record.id } }
}

/** LGPD revocation at any time: disables cloud apply (new and paused runs) and is logged. */
export async function revokeLegalAcceptanceAction(input: unknown): Promise<Result<{ cancelledRuns: number }>> {
  const parsed = z.object({ slug: slugSchema }).safeParse(input)
  if (!parsed.success) return { ok: false, error: "Documento inválido." }
  const auth = await getUserContext()
  if (!auth.ok) return { ok: false, error: "Entre novamente." }
  const { ctx } = auth
  const doc = (await loadCurrentLegalDocuments())[parsed.data.slug]
  if (!doc) return { ok: false, error: "Documento não encontrado." }
  const { data: claims } = await ctx.supabase.auth.getClaims()
  const meta = await requestMeta()
  const record = await appendEvidence({
    user_id: ctx.user.id,
    email: ctx.user.email,
    action: "revoke",
    document_id: doc.id,
    document_slug: doc.slug,
    document_version: doc.version,
    document_sha256: doc.sha256,
    checkboxes: {},
    typed_confirmation: null,
    ip: meta.ip,
    user_agent: meta.userAgent,
    session_id: sessionIdFromClaims(claims?.claims as Record<string, unknown> | undefined),
    locale: meta.locale,
  })
  if (!record) return { ok: false, error: "Não foi possível registrar a revogação." }
  const cancelled = await cancelActiveApplyRuns(ctx.user.id)
  await audit({
    userId: ctx.user.id,
    actor: "usuario",
    action: "legal.revoked",
    targetType: "legal_acceptance",
    targetId: record.id,
    details: { slug: doc.slug, version: doc.version, cancelled_runs: cancelled },
  }).catch(() => undefined)
  revalidatePath("/app/configuracoes/riscos")
  return { ok: true, data: { cancelledRuns: cancelled } }
}

function certificateText(cert: NonNullable<Awaited<ReturnType<typeof buildCertificate>>>): string {
  const r = cert.record
  return [
    `Cópia do seu ${r.action === "accept" ? "aceite" : "registro de revogação"} — ${cert.document?.title ?? r.document_slug}`,
    "",
    `Versão: ${r.document_version}`,
    `Hash SHA-256 do texto: ${r.document_sha256}`,
    `Data/hora (UTC): ${r.accepted_at}`,
    `Registro: ${r.id} · hash ${r.record_hash}`,
    `Itens marcados: ${Object.entries(r.checkboxes).filter(([, v]) => v).map(([k]) => k).join(", ") || "-"}`,
    "",
    cert.disclaimer,
    "",
    "----- Texto aceito -----",
    "",
    cert.document?.text ?? "",
  ].join("\n")
}

/**
 * Sends the user a copy of the accepted text and its hash — ONLY when the user clicks it.
 * Default: transactional e-mail (Resend) to the account e-mail. "gmail" uses the user's own
 * Gmail send flow and requires the gmail.send scope already granted.
 */
export async function sendAcceptanceCopyAction(input: unknown): Promise<Result<{ via: string }>> {
  const parsed = z
    .object({ recordId: z.uuid(), via: z.enum(["transacional", "gmail"]), approved: z.literal(true) })
    .safeParse(input)
  if (!parsed.success) return { ok: false, error: "Confirme o envio da cópia." }
  const auth = await getUserContext()
  if (!auth.ok) return { ok: false, error: "Entre novamente." }
  const { ctx } = auth
  const cert = await buildCertificate(parsed.data.recordId, ctx.user.id)
  if (!cert) return { ok: false, error: "Registro não encontrado." }
  const subject = `Cópia do aceite: ${cert.document?.title ?? cert.record.document_slug} (v${cert.record.document_version})`
  const text = certificateText(cert)
  if (parsed.data.via === "gmail") {
    const runtime = getGmailRuntime()
    const connection = runtime ? await runtime.store.getConnection(ctx.user.id) : null
    if (!runtime?.oauth || !connection?.scopes.includes(GMAIL_SEND_SCOPE))
      return { ok: false, error: "Seu Gmail não tem permissão de envio. Use o e-mail do sistema." }
    const sealed = await runtime.store.readRefreshToken(ctx.user.id)
    if (!sealed) return { ok: false, error: "Reconecte o Gmail." }
    const refresh = await getFieldCrypto().decryptFieldText(ctx.user.id, sealed)
    const access = await runtime.oauth.refreshAccessToken(refresh)
    await sendGmailMessage(async () => access.accessToken, {
      from: connection.googleEmail,
      to: [ctx.user.email],
      cc: [],
      subject,
      bodyText: text,
    })
  } else {
    const mailer = createMailerFromEnv()
    if (mailer.kind !== "resend")
      return { ok: false, error: "E-mail do sistema não configurado. Baixe a cópia em JSON." }
    const sent = await mailer.send({
      to: ctx.user.email,
      subject,
      text,
      idempotencyKey: `legal-copy-${cert.record.id}`,
    })
    if (sent.status !== "sent") return { ok: false, error: "Falha ao enviar. Baixe a cópia em JSON." }
  }
  await audit({
    userId: ctx.user.id,
    actor: "usuario",
    action: "legal.copy_sent",
    targetType: "legal_acceptance",
    targetId: cert.record.id,
    details: { via: parsed.data.via },
  }).catch(() => undefined)
  return { ok: true, data: { via: parsed.data.via } }
}

/** Domain → risk level list (admin-editable) for the job-card badge. Non-sensitive. */
export async function listSiteRiskLevelsAction(): Promise<{ domain: string; level: "baixo" | "medio" | "alto" }[]> {
  const auth = await getUserContext()
  if (!auth.ok) return []
  const { loadSiteRiskLevels } = await import("@/lib/legal/server")
  return (await loadSiteRiskLevels()).map(({ domain, level }) => ({ domain, level }))
}
