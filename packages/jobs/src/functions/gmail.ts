import { runGmailSync } from "@vagapilot/gmail"

import { getJobsGmailRuntime } from "../gmail-runtime.js"
import { cron, eventType, NonRetriableError } from "inngest"
import { z } from "zod"

import { inngest } from "../client.js"
import { createAdminClient } from "../deps.js"
import { createMailerFromEnv } from "../mailer.js"
import { runDueReminders } from "../reminders.js"

/** Sent after OAuth completes (P4.1): first load of the last 90 days. */
export const gmailConnectedEvent = eventType("gmail/connected", {
  schema: z.object({ userId: z.uuid() }),
})

/** One incremental sync for one user (fan-out of the 2 h cron, or "Sincronizar agora"). */
export const gmailSyncRequestedEvent = eventType("gmail/sync.requested", {
  schema: z.object({ userId: z.uuid() }),
})

/** DELETE /api/google/connection: cancels running syncs of that user at once (CA11.3). */
export const gmailRevokedEvent = eventType("gmail/revoked", {
  schema: z.object({ userId: z.uuid() }),
})

const cancelOnRevoke = [
  { event: gmailRevokedEvent, if: "async.data.userId == event.data.userId" },
]

export const gmailInitialSyncFunction = inngest.createFunction(
  {
    id: "gmail-initial-sync",
    triggers: [gmailConnectedEvent],
    cancelOn: cancelOnRevoke,
    concurrency: { key: "event.data.userId", limit: 1 },
    retries: 3,
  },
  async ({ event, step }) => {
    const result = await step.run("sync-90-days", () =>
      runGmailSync(getJobsGmailRuntime(), event.data.userId, "initial", {
        actor: "worker",
      })
    )
    if (result.status === "error")
      throw new NonRetriableError(`gmail sync: ${result.code}`)
    return result
  }
)

export const gmailUserSyncFunction = inngest.createFunction(
  {
    id: "gmail-incremental-sync-user",
    triggers: [gmailSyncRequestedEvent],
    cancelOn: cancelOnRevoke,
    concurrency: { key: "event.data.userId", limit: 1 },
    retries: 2,
  },
  async ({ event, step }) => {
    const result = await step.run("sync-history", () =>
      runGmailSync(getJobsGmailRuntime(), event.data.userId, "incremental", {
        actor: "worker",
      })
    )
    await step.run("reminders", () =>
      runDueReminders(
        { admin: createAdminClient(), mailer: createMailerFromEnv() },
        { userId: event.data.userId }
      )
    )
    return result
  }
)

/** Cron every 15 min (application replies arrive fast; incremental history sync is cheap): fans out one event per active connection. */
export const gmailIncrementalSyncFunction = inngest.createFunction(
  { id: "gmail-incremental-sync", triggers: [cron("*/15 * * * *")] },
  async ({ step }) => {
    const userIds = await step.run("active-connections", () =>
      getJobsGmailRuntime().store.listActiveUserIds()
    )
    if (userIds.length > 0) {
      await step.sendEvent(
        "fan-out",
        userIds.map((userId) => gmailSyncRequestedEvent.create({ userId }))
      )
    }
    return { users: userIds.length }
  }
)

/** Reminders 48 h / 12 h before deadlines (RF11.6). Every 30 min keeps them on time. */
export const deadlineRemindersFunction = inngest.createFunction(
  { id: "deadline-reminders", triggers: [cron("*/30 * * * *")] },
  async ({ step }) =>
    step.run("send-due-reminders", () =>
      runDueReminders({
        admin: createAdminClient(),
        mailer: createMailerFromEnv(),
      })
    )
)

export const gmailFunctions = [
  gmailInitialSyncFunction,
  gmailUserSyncFunction,
  gmailIncrementalSyncFunction,
  deadlineRemindersFunction,
]
