import type { JobAlertBatch } from "@vagapilot/gmail"

import { createAdminClient } from "./deps.js"
import { startIngestionForUser } from "./start-ingestion.js"

/** RF15.2: LinkedIn alert links from Gmail sync → job ingestion batches (≤ 20 URLs). */
export async function ingestJobAlertBatch(batch: JobAlertBatch): Promise<void> {
  if (batch.urls.length === 0) return
  const admin = createAdminClient()
  await startIngestionForUser(admin, batch.userId, {
    urls: batch.urls,
    batchId: `gmail-alert-${batch.emailThreadId}`,
  })
}
