import { createGmailRuntime, type GmailRuntime } from "@vagapilot/gmail"

import { ingestJobAlertBatch } from "./job-alert-ingest.js"

let runtime: GmailRuntime | undefined

/** Gmail runtime for Inngest workers (RF15.2 ingestion hook). */
export function getJobsGmailRuntime(): GmailRuntime {
  runtime ??= createGmailRuntime({ onJobAlert: ingestJobAlertBatch })
  return runtime
}
