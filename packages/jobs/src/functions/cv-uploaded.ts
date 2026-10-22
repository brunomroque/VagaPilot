import { NonRetriableError } from "inngest"

import { cvUploadedEvent, inngest } from "../client.js"
import { createCvProcessingDeps } from "../deps.js"
import { extractAndStoreCvText, proposeFactsFromCv } from "../process-cv.js"

/** `cv/uploaded`: text extraction, then grounded fact proposals (P1.2, P1.3). */
export const cvUploadedFunction = inngest.createFunction(
  {
    id: "cv-uploaded",
    triggers: [cvUploadedEvent],
    retries: 3,
    concurrency: { key: "event.data.userId", limit: 1 },
  },
  async ({ event, step }) => {
    const input = event.data
    const deps = createCvProcessingDeps({ actor: "worker" })

    const text = await step.run("extract-text", () =>
      extractAndStoreCvText(deps, input)
    )
    if (text.status !== "ok") {
      throw new NonRetriableError(`CV text extraction failed: ${text.code}`)
    }

    const facts = await step.run("propose-facts", () =>
      proposeFactsFromCv(deps, input, text.text)
    )
    return { pages: text.pages, ...facts }
  }
)
