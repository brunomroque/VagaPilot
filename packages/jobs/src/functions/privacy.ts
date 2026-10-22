import { listDueDeletions, purgeUserAccount } from "../account-purge.js"
import { createAdminClient } from "../deps.js"
import { inngest } from "../client.js"

/** Daily sweep: purge accounts whose 15-day deletion window elapsed (P6.4). */
export const accountPurgeCronFunction = inngest.createFunction(
  {
    id: "account-purge-due",
    triggers: [{ cron: "TZ=America/Sao_Paulo 0 4 * * *" }],
  },
  async ({ step }) => {
    const due = await step.run("list-due", () =>
      listDueDeletions(createAdminClient())
    )
    if (due.length > 0) {
      await step.sendEvent(
        "queue-purges",
        due.map((userId) => ({
          name: "account/purge.requested",
          data: { userId },
        }))
      )
    }
    return { queued: due.length }
  }
)

export const accountPurgeFunction = inngest.createFunction(
  {
    id: "account-purge-requested",
    triggers: [{ event: "account/purge.requested" }],
  },
  async ({ event, step }) => {
    const userId = String(event.data.userId)
    await step.run("purge", () => purgeUserAccount(userId))
    return { purged: userId }
  }
)
