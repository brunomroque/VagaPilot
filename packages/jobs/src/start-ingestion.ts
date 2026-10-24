import { randomUUID } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"
import { canonicalizeUrl, detectSource } from "@vagapilot/ats-adapters"

import {
  inngest,
  isInngestConfigured,
  jobIngestRequestedEvent,
} from "./client.js"
import { createAdminClient, createIngestDeps } from "./deps.js"
import { processJobIngestion } from "./ingest.js"

export type IngestionItem = {
  ingestionId: string
  url: string | null
  status: "pendente" | "processando" | "concluida" | "falhou" | "bloqueada"
  errorCode: string | null
  jobMatchId: string | null
}

type IngestionRow = {
  id: string
  input_url: string | null
  status: IngestionItem["status"]
  error_code: string | null
  job_match_id: string | null
}

function toItem(row: IngestionRow): IngestionItem {
  return {
    ingestionId: row.id,
    url: row.input_url,
    status: row.status,
    errorCode: row.error_code,
    jobMatchId: row.job_match_id,
  }
}

/** Under Netlify's 60 s function limit, so the row is always closed by us. */
export const INLINE_DEADLINE_MS = 50_000

export async function withDeadline<T>(
  work: Promise<T>,
  ms: number,
  onTimeout: () => Promise<void>
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      void onTimeout().finally(() =>
        reject(new Error(`ingestion timed out after ${ms} ms`))
      )
    }, ms)
  })
  try {
    return await Promise.race([work, deadline])
  } finally {
    clearTimeout(timer)
  }
}

async function runInline(userId: string, ingestionIds: string[]) {
  const admin = createAdminClient()
  const deps = createIngestDeps({ admin, actor: "worker" })
  await Promise.all(
    ingestionIds.map((ingestionId) =>
      withDeadline(
        processJobIngestion(deps, { userId, ingestionId }),
        INLINE_DEADLINE_MS,
        async () => {
          // Bruno 24/10: a link stayed "Analisando…" forever. The function can be cut off
          // (Netlify limit) mid-analysis; end the row as a timeout so the chat offers paste-text.
          await admin
            .from("job_ingestions")
            .update({ status: "falhou", error_code: "timeout" })
            .eq("id", ingestionId)
            .eq("user_id", userId)
            .in("status", ["pendente", "processando"])
        }
      ).catch((error: unknown) => {
        console.error("job ingestion failed", {
          ingestionId,
          reason: error instanceof Error ? error.message : "unknown",
        })
      })
    )
  )
}

/** Creates `job_ingestions` rows and enqueues processing (10.3 / RF15.2). */
export async function startIngestionForUser(
  supabase: SupabaseClient,
  userId: string,
  input: {
    urls?: string[]
    text?: string
    replaceUrl?: string | null
    conversationId?: string | null
    batchId?: string
    /** When true, only inserts rows / sends Inngest — caller runs inline processing. */
    enqueueOnly?: boolean
  }
): Promise<{ batchId: string; items: IngestionItem[] }> {
  const batchId = input.batchId ?? randomUUID()
  const rows = input.text
    ? [{ input_url: input.replaceUrl ?? null, input_text: input.text }]
    : (input.urls ?? []).map((url) => ({ input_url: url, input_text: null }))
  if (rows.length === 0) return { batchId, items: [] }

  const { data, error } = await supabase
    .from("job_ingestions")
    .insert(
      rows.map((row) => ({
        user_id: userId,
        batch_id: batchId,
        conversation_id: input.conversationId ?? null,
        input_url: row.input_url,
        input_text: row.input_text,
        canonical_url: row.input_url ? canonicalizeUrl(row.input_url) : null,
        source: row.input_url ? detectSource(row.input_url) : null,
      }))
    )
    .select("id, input_url, status, error_code, job_match_id")
  if (error || !data) {
    throw new Error(`job_ingestions insert failed: ${error?.message}`)
  }
  const created = data as IngestionRow[]
  if (isInngestConfigured()) {
    await inngest.send(
      created.map((row) =>
        jobIngestRequestedEvent.create({
          userId,
          ingestionId: row.id,
        })
      )
    )
  } else if (!input.enqueueOnly) {
    void runInline(
      userId,
      created.map((row) => row.id)
    )
  }
  return { batchId, items: created.map(toItem) }
}

export async function runIngestionInline(
  userId: string,
  ingestionIds: string[]
): Promise<void> {
  await runInline(userId, ingestionIds)
}
