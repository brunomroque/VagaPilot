import process from "node:process"

import { eventType, Inngest } from "inngest"
import { z } from "zod"

export const inngest = new Inngest({ id: "vagapilot" })

/** Sent after a CV file lands in `cvs/{user_id}/` and its `cv_versions` row exists (P1.2). */
export const cvUploadedEvent = eventType("cv/uploaded", {
  schema: z.object({
    userId: z.uuid(),
    cvVersionId: z.uuid(),
  }),
})

/** One link (or pasted text) of a batch, after its `job_ingestions` row exists (8.4, P2.2). */
export const jobIngestRequestedEvent = eventType("job/ingest.requested", {
  schema: z.object({
    userId: z.uuid(),
    ingestionId: z.uuid(),
  }),
})

/** A saved search should run now (cron or "Executar agora"). */
export const searchRunRequestedEvent = eventType("search/run.requested", {
  schema: z.object({
    userId: z.uuid(),
    savedSearchId: z.uuid(),
  }),
})

type Env = Readonly<Record<string, string | undefined>>

/**
 * Inngest is used when a dev server (`INNGEST_DEV`) or Inngest Cloud (`INNGEST_EVENT_KEY`) is
 * configured. Otherwise callers run the job inline (synchronous fallback).
 */
export function isInngestConfigured(env: Env = process.env): boolean {
  return Boolean(env.INNGEST_DEV?.trim() || env.INNGEST_EVENT_KEY?.trim())
}
