import { logAudit, type AuditActor } from "@vagapilot/core/audit"
import { formatDateTimeBR } from "@vagapilot/core/dates"
import {
  buildGmailSearchQuery,
  INITIAL_SYNC_DAYS,
  looksLikePromptInjection,
  parseEmailAddress,
  prefilterEmail,
  toSnippet,
} from "@vagapilot/core/email"
import { toZonedIso } from "@vagapilot/core/email-dates"
import {
  linkEmailToApplication,
  type LinkableApplication,
} from "@vagapilot/core/email-linking"
import {
  decideEmailOutcome,
  nextActionForEmailClass,
  shouldWriteNextAction,
  type EmailDecision,
} from "@vagapilot/core/email-outcome"

import { parseLinkedInJobAlert } from "./alerts.js"
import { GmailApiError, type GmailApi, type GmailMessageMeta } from "./api.js"
import {
  classifyEmail,
  type EmailClassification,
} from "./classify/classify-email.js"
import { GmailTokenError, type GmailRuntime } from "./runtime.js"
import { persistableClass, type ThreadExtracted } from "./store.js"

/**
 * Gmail sync pipeline (P4.2/P4.3, 8.4, J5): list → prefilter on headers → classify (body kept in
 * memory only) → store metadata + snippet → link → apply / Revise. The connection is re-checked
 * before every message, so a revocation stops the run at once (CA11.3). E-mail content can only
 * produce the tracker writes below; there is no path from an e-mail to an external action (RF11.10).
 */

export type SyncMode = "initial" | "incremental"

export type SyncCounts = {
  listed: number
  opened: number
  skipped: number
  verificationCodesSkipped: number
  injectionsBlocked: number
  stored: number
  applied: number
  review: number
  created: number
  linked: number
  alerts: number
  deadlines: number
}

export type SyncResult =
  | ({ status: "ok"; mode: SyncMode } & SyncCounts)
  | ({ status: "stopped"; mode: SyncMode } & SyncCounts)
  | { status: "not_connected" | "locked" }
  | { status: "error"; code: string }

/** Upper bound of messages per run (the first load can be large). */
export const MAX_MESSAGES_PER_RUN = 500
const SYNC_LOCK_MS = 10 * 60_000

function emptyCounts(): SyncCounts {
  return {
    listed: 0,
    opened: 0,
    skipped: 0,
    verificationCodesSkipped: 0,
    injectionsBlocked: 0,
    stored: 0,
    applied: 0,
    review: 0,
    created: 0,
    linked: 0,
    alerts: 0,
    deadlines: 0,
  }
}

async function listInitial(
  api: GmailApi,
  companies: string[],
  days: number
): Promise<string[]> {
  const query = buildGmailSearchQuery({ newerThanDays: days, companies })
  const ids: string[] = []
  let pageToken: string | null = null
  do {
    const page = await api.listMessages(query, { pageToken, maxResults: 100 })
    ids.push(...page.messages.map((message) => message.id))
    pageToken = page.nextPageToken
  } while (pageToken && ids.length < MAX_MESSAGES_PER_RUN)
  // messages.list is newest first; process oldest first.
  return ids.slice(0, MAX_MESSAGES_PER_RUN).reverse()
}

async function listSince(
  api: GmailApi,
  historyId: string
): Promise<{ ids: string[]; historyId: string }> {
  const ids: string[] = []
  let pageToken: string | null = null
  let latest = historyId
  do {
    const page = await api.listHistory(historyId, { pageToken })
    ids.push(...page.messageIds)
    latest = page.historyId
    pageToken = page.nextPageToken
  } while (pageToken && ids.length < MAX_MESSAGES_PER_RUN)
  return {
    ids: [...new Set(ids)].slice(0, MAX_MESSAGES_PER_RUN),
    historyId: latest,
  }
}

/** Evidence shown in the timeline (CA11.5): sender, subject, date and snippet. */
export function evidenceText(meta: GmailMessageMeta, snippet: string): string {
  const from = parseEmailAddress(meta.from)
  return [
    `De: ${from.name ? `${from.name} <${from.address ?? ""}>` : (from.address ?? "")}`,
    `Assunto: ${meta.subject}`,
    `Data: ${formatDateTimeBR(meta.receivedAt)}`,
    `Trecho: ${snippet}`,
  ].join("\n")
}

function extractedOf(
  classification: EmailClassification,
  decision: EmailDecision | null,
  links?: string[]
): ThreadExtracted {
  const extracted: ThreadExtracted = {
    company: classification.company,
    role: classification.role,
    deadline: classification.deadline
      ? toZonedIso(classification.deadline)
      : null,
    interview_at: classification.interviewAt
      ? toZonedIso(classification.interviewAt)
      : null,
    link: classification.link,
    model: classification.model,
    prompt_version: classification.promptVersion,
  }
  if (links) extracted.links = links
  if (decision?.kind === "review") {
    extracted.suggestion = {
      status: decision.suggestedStatus,
      reason: decision.reason,
    }
  }
  if (decision?.kind === "create") {
    extracted.suggestion = { status: "enviada", reason: "created_from_email" }
  }
  return extracted
}

type MessageContext = {
  runtime: GmailRuntime
  api: GmailApi
  userId: string
  applications: LinkableApplication[]
  counts: SyncCounts
}

/** Thrown when the connection disappears mid-message: nothing more is written (CA11.3). */
class SyncStopped extends Error {}

async function processMessage(
  context: MessageContext,
  messageId: string
): Promise<void> {
  const { runtime, api, userId, counts } = context
  const { store } = runtime
  const ensureActive = async () => {
    if (!(await store.isActive(userId))) throw new SyncStopped()
  }
  const meta = await api.getMetadata(messageId)
  const from = parseEmailAddress(meta.from)
  const filter = prefilterEmail({
    from,
    subject: meta.subject,
    companies: context.applications.map((application) => application.company),
  })
  if (filter.action === "skip") {
    counts.skipped += 1
    if (filter.reason === "verification_code")
      counts.verificationCodesSkipped += 1
    return
  }

  counts.opened += 1
  const body = await api.getBodyText(messageId)
  if (looksLikePromptInjection(`${meta.subject}\n${body}`)) {
    counts.injectionsBlocked += 1
    counts.skipped += 1
    return
  }
  const classification = await classifyEmail(
    {
      fromAddress: from.address,
      fromName: from.name,
      subject: meta.subject,
      body,
      receivedAt: meta.receivedAt,
      knownCompanies: context.applications.map(
        (application) => application.company
      ),
    },
    { model: runtime.classifierModel }
  )
  const storedClass = persistableClass(classification.class)
  if (!storedClass || storedClass === "irrelevante") {
    counts.skipped += 1
    if (!storedClass) counts.verificationCodesSkipped += 1
    return
  }

  const snippet = toSnippet(meta.snippet)
  const base = {
    gmailThreadId: meta.threadId,
    gmailMessageId: meta.id,
    fromAddress: from.address,
    fromDomain: from.domain,
    subject: meta.subject,
    receivedAt: meta.receivedAt,
    snippet,
    classification: storedClass,
    confidence: classification.confidence,
  }

  if (storedClass === "vaga_alerta") {
    const urls = parseLinkedInJobAlert(body)
    await ensureActive()
    const threadId = await store.insertThread(userId, {
      ...base,
      extracted: extractedOf(classification, null, urls),
      applicationId: null,
      reviewStatus: "auto",
    })
    if (!threadId) return
    counts.stored += 1
    if (urls.length > 0) {
      counts.alerts += 1
      await runtime.onJobAlert?.({
        userId,
        emailThreadId: threadId,
        receivedAt: meta.receivedAt,
        urls,
      })
    }
    return
  }

  const link = linkEmailToApplication(
    {
      fromName: from.name,
      fromDomain: from.domain,
      subject: meta.subject,
      text: body.slice(0, 4_000),
      receivedAt: meta.receivedAt,
      company: classification.company,
      role: classification.role,
    },
    context.applications
  )
  const linked = context.applications.find(
    (application) => application.id === link.applicationId
  )
  const decision = decideEmailOutcome({
    classification: classification.class,
    confidence: classification.confidence,
    link,
    currentStatus: linked?.status ?? null,
    hasCompany: Boolean(classification.company),
  })
  if (decision.kind === "skip") {
    counts.skipped += 1
    return
  }

  const review = decision.kind === "review" || decision.kind === "create"
  await ensureActive()
  const threadId = await store.insertThread(userId, {
    ...base,
    extracted: extractedOf(classification, decision),
    applicationId: decision.kind === "create" ? null : decision.applicationId,
    reviewStatus: review ? "revisar" : "auto",
  })
  if (!threadId) return
  counts.stored += 1

  switch (decision.kind) {
    case "apply": {
      const evidenceId = await store.insertEvidence(
        userId,
        decision.applicationId,
        evidenceText(meta, snippet)
      )
      const result = await store.changeStatus(userId, {
        applicationId: decision.applicationId,
        from: decision.from,
        to: decision.to,
        confidence: classification.confidence,
        threadId,
        evidenceId,
      })
      if (result === "status_conflict") {
        await store.updateThread(userId, threadId, {
          reviewStatus: "revisar",
          extracted: {
            ...extractedOf(classification, null),
            suggestion: { status: decision.to, reason: "needs_review" },
          },
        })
        counts.review += 1
        break
      }
      if (linked) linked.status = decision.to
      counts.applied += 1
      await store.notify(userId, {
        kind: "status_changed",
        params: {
          company: linked?.company ?? "",
          from: decision.from,
          to: decision.to,
        },
        applicationId: decision.applicationId,
        emailThreadId: threadId,
        dedupeKey: `status:${threadId}`,
      })
      break
    }
    case "link":
      counts.linked += 1
      await store.linkEmailEvent(userId, {
        applicationId: decision.applicationId,
        threadId,
        confidence: classification.confidence,
      })
      break
    case "review":
      counts.review += 1
      break
    case "create": {
      const company = classification.company ?? ""
      const applicationId = await store.createApplicationFromEmail(userId, {
        company,
        roleTitle: classification.role ?? "Cargo não informado",
        appliedAt: meta.receivedAt,
        link: classification.link,
        confidence: classification.confidence,
        threadId,
        evidenceText: evidenceText(meta, snippet),
      })
      await store.updateThread(userId, threadId, { applicationId })
      context.applications.push({
        id: applicationId,
        company,
        roleTitle: classification.role ?? "",
        status: "enviada",
        link: classification.link,
        appliedAt: meta.receivedAt.toISOString(),
        createdAt: new Date().toISOString(),
      })
      counts.created += 1
      counts.review += 1
      break
    }
    default: {
      const unreachable: never = decision
      throw new Error(`Unhandled decision: ${String(unreachable)}`)
    }
  }

  if (
    (decision.kind === "apply" || decision.kind === "link") &&
    shouldWriteNextAction(decision, classification.confidence)
  ) {
    const action = nextActionForEmailClass(classification.class)
    const dueAt =
      classification.class === "teste_etapa"
        ? classification.deadline
        : classification.class === "convite_entrevista"
          ? classification.interviewAt
          : null
    if (action && dueAt && dueAt.getTime() > runtime.now().getTime()) {
      await store.setNextAction(userId, {
        applicationId: decision.applicationId,
        action,
        dueAt,
        threadId,
      })
      counts.deadlines += 1
    }
  }
}

export type SyncOptions = {
  actor?: AuditActor
  /** Initial load window (RF11.2: 90 days). */
  days?: number
}

/**
 * One sync run for one user. `initial` (or a missing/expired history id) lists the filtered
 * 90 days; `incremental` reads history.list since `last_history_id`.
 */
export async function runGmailSync(
  runtime: GmailRuntime,
  userId: string,
  mode: SyncMode,
  options: SyncOptions = {}
): Promise<SyncResult> {
  const { store, log } = runtime
  const connection = await store.getConnection(userId)
  if (!connection || connection.status !== "ativo")
    return { status: "not_connected" }
  if (!(await store.claimSyncLock(userId, SYNC_LOCK_MS, runtime.now())))
    return { status: "locked" }

  const counts = emptyCounts()
  let effectiveMode: SyncMode = mode
  try {
    const api = await runtime.apiFor(userId)
    const applications = await store.listApplications(userId)
    const companies = applications.map((application) => application.company)

    let ids: string[]
    let historyId: string | null
    if (mode === "incremental" && connection.lastHistoryId) {
      try {
        const since = await listSince(api, connection.lastHistoryId)
        ids = since.ids
        historyId = since.historyId
      } catch (error) {
        if (!(
          error instanceof GmailApiError && error.code === "history_expired"
        ))
          throw error
        const lastSync = connection.lastSyncedAt
          ? Date.parse(connection.lastSyncedAt)
          : NaN
        const days = Number.isFinite(lastSync)
          ? Math.min(
              INITIAL_SYNC_DAYS,
              Math.ceil((runtime.now().getTime() - lastSync) / 86_400_000) + 1
            )
          : INITIAL_SYNC_DAYS
        historyId = (await api.getProfile()).historyId
        ids = await listInitial(api, companies, days)
      }
    } else {
      effectiveMode = "initial"
      historyId = (await api.getProfile()).historyId
      ids = await listInitial(api, companies, options.days ?? INITIAL_SYNC_DAYS)
    }

    counts.listed = ids.length
    const known = await store.knownMessageIds(userId, ids)
    // Oldest first, so a process moves forward in the order the company wrote.
    const pending = ids.filter((id) => !known.has(id))
    const context: MessageContext = {
      runtime,
      api,
      userId,
      applications,
      counts,
    }

    for (const messageId of pending) {
      if (!(await store.isActive(userId))) {
        log("sync.stopped", {
          mode: effectiveMode,
          processed: counts.opened + counts.skipped,
        })
        return { status: "stopped", mode: effectiveMode, ...counts }
      }
      try {
        await processMessage(context, messageId)
      } catch (error) {
        if (!(error instanceof SyncStopped)) throw error
        log("sync.stopped", {
          mode: effectiveMode,
          processed: counts.opened + counts.skipped,
        })
        return { status: "stopped", mode: effectiveMode, ...counts }
      }
    }

    if (!(await store.isActive(userId))) {
      return { status: "stopped", mode: effectiveMode, ...counts }
    }
    await store.finishSync(userId, { historyId, syncedAt: runtime.now() })
    if (counts.review > 0) {
      await store.notify(userId, {
        kind: "review_needed",
        params: { count: counts.review },
        dedupeKey: `review:${runtime.now().toISOString()}`,
      })
    }
    await logAudit(runtime.audit, {
      userId,
      actor: options.actor ?? "worker",
      action: "gmail.synced",
      targetType: "gmail_connection",
      details: { mode: effectiveMode, ...counts },
    })
    log("sync.done", { mode: effectiveMode, ...counts })
    return { status: "ok", mode: effectiveMode, ...counts }
  } catch (error) {
    if (error instanceof GmailTokenError) {
      await store.markError(userId, error.code)
      await store.notify(userId, {
        kind: "gmail_error",
        params: { code: error.code },
        dedupeKey: `gmail_error:${error.code}:${runtime.now().toISOString().slice(0, 10)}`,
      })
      log("sync.token_error", { code: error.code })
      return { status: "error", code: error.code }
    }
    if (error instanceof GmailApiError && error.code === "unauthorized") {
      await store.markError(userId, "unauthorized")
      log("sync.unauthorized", {})
      return { status: "error", code: "unauthorized" }
    }
    await store.releaseLock(userId)
    log("sync.failed", {
      name: error instanceof Error ? error.name : "unknown",
    })
    throw error
  }
}
