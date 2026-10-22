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

async function runInline(userId: string, ingestionIds: string[]) {
  const admin = createAdminClient()
  const deps = createIngestDeps({ admin, actor: "worker" })
  await Promise.all(
    ingestionIds.map((ingestionId) =>
      processJobIngestion(deps, { userId, ingestionId }).catch(
        (error: unknown) => {
          console.error("job ingestion failed", {
            ingestionId,
            reason: error instanceof Error ? error.message : "unknown",
          })
        }
      )
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
