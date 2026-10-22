import { cvUploadedFunction } from "./cv-uploaded.js"
import { gmailFunctions } from "./gmail.js"
import {
  jobIngestFunction,
  savedSearchesCronFunction,
  searchRunFunction,
} from "./jobs.js"
import { accountPurgeCronFunction, accountPurgeFunction } from "./privacy.js"

/** Every Inngest function served by POST /api/inngest. */
export const functions = [
  cvUploadedFunction,
  ...gmailFunctions,
  jobIngestFunction,
  savedSearchesCronFunction,
  searchRunFunction,
  accountPurgeCronFunction,
  accountPurgeFunction,
]
