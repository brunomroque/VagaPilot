import {
  inngest,
  jobIngestRequestedEvent,
  searchRunRequestedEvent,
} from "../client.js"
import { createAdminClient, createIngestDeps } from "../deps.js"
import { processJobIngestion } from "../ingest.js"
import { dueSearches, runSavedSearch } from "../searches.js"

/** `job/ingest.requested` (8.4): one link per run, up to 3 in parallel per user (CA6.3). */
export const jobIngestFunction = inngest.createFunction(
  {
    id: "job-ingest",
    triggers: [jobIngestRequestedEvent],
    retries: 2,
    concurrency: { key: "event.data.userId", limit: 3 },
  },
  async ({ event, step }) =>
    step.run("ingest", () =>
      processJobIngestion(createIngestDeps({ actor: "worker" }), event.data)
    )
)

/** Hourly check of saved searches whose slot passed (RF4A.3). */
export const savedSearchesCronFunction = inngest.createFunction(
  {
    id: "saved-searches-cron",
    triggers: [{ cron: "TZ=America/Sao_Paulo 0 * * * *" }],
  },
  async ({ step }) => {
    const due = await step.run("due", () =>
      dueSearches(createAdminClient(), new Date())
    )
    if (due.length > 0) {
      await step.sendEvent(
        "run-searches",
        due.map((item) => searchRunRequestedEvent.create(item))
      )
    }
    return { scheduled: due.length }
  }
)

export const searchRunFunction = inngest.createFunction(
  {
    id: "search-run",
    triggers: [searchRunRequestedEvent],
    retries: 2,
    concurrency: { key: "event.data.userId", limit: 1 },
  },
  async ({ event, step }) =>
    step.run("run", () =>
      runSavedSearch({ admin: createAdminClient() }, event.data)
    )
)
